import { ModuleName } from "../ssm-launch.js";
import { log } from "./functions.js";

export class Texture2Polygon {
    constructor(name, walls) {
        this.subSceneName = name;
        this.instanceWalls = walls;
        this.pixels = undefined;
        this.compressedPixelData = {
            vertical: new Map(),
            horizontal: new Map()
        };
        this.vertexCoords = new Set();
        this.perimeterPixels = new Set();
        this.omitWalls = new Set();
        this.polygonVertexCoordinates = [];
        this.boundingBox = {};
        this.drawingColor = undefined;
    }

    get #isDebugging() {
        return game.modules.get('_dev-mode')?.api?.getPackageDebugValue(ModuleName);
    }

    /**
     * The only non-private method.  This is important because the other methods have to be
     * executed in a specific order, or they will generate incorrect results.
     * This method gets called by an instance of this class to generate a drawing polygon from the
     * explored 'masking' texture.
     * 
     * @returns {boolean}               // True on a success
     */
    async generateDrawingPolygon() {
        let confirm = await this.#getPixelData();
        if ( !confirm ) return false;
        this.#compressPixelData();
        confirm = await this.#extractVerticesFromWalls();
        if ( !confirm ) return false;
        confirm = await this.#removeDanglingWalls();
        if ( !confirm ) return false;
        confirm = await this.#extractPerimeterPixels();
        if ( !confirm ) return false;
        confirm = await this.#removeInteriorWallsVertices();
        if ( !confirm ) return false;
        this.#linkVerticesByWalls();
        confirm = await this.#removeSameSlopeVertices();
        if ( !confirm ) return false;
        confirm = await this.#addBoundaryVertices();
        if ( !confirm ) return false;
        this.#linkFinalVertices();
        confirm = await this.#prepareVertexData();
        if ( !confirm ) return false;
        this.#generateDrawingPolygon();
        return true;
    }

    /**
     * Prompt PIXI to generate pixel data from the explored texture saved by Foundry.
     * Result is saved to this.pixels
     * @private
     * @returns {boolean}                       // True on success.
     */
    async #getPixelData() {

        // texSprite is the saved explored texture.  It is black (#000000) with white (#FFFFFF) defining explored areas.
        const texSprite = new PIXI.Sprite(canvas.sight.saved.texture);
        // A temporary container to use.
        const tempContainer = new PIXI.Container();
        tempContainer.addChild(texSprite);

        this.pixels = canvas.app.renderer.extract.pixels(tempContainer);

        // If devMode module is active and debugging is enabled, show the texture generated from the pixel data on the screen.
        // Once OK has been clicked in a confirmation dialog, the texture will be removed and code execution will proceed.
        if ( this.#isDebugging ) {
            const d = canvas.dimensions;
            const options = {
                width: d.sceneWidth,
                height: d.sceneHeight
            }
            const br = new PIXI.resources.BufferResource(this.pixels, options);
            const bt = new PIXI.BaseTexture(br);
            const tex = new PIXI.Texture(bt);
            const tempSprite = new PIXI.Sprite(tex);

            canvas.stage.addChild(tempSprite);
            tempSprite.position = {x: d.paddingX, y: d.paddingY};

            const confirm  = await Dialog.confirm({
                title: "Review Texture from pixel data.",
                content: "<p>Click YES to continue if texture is correct.</p><p>Click NO to abort execution if texture is incorrect.</p>",
                yes: () => {return true},
                no: () => {return false}
            })

            canvas.stage.removeChild(tempSprite);
            tempSprite.destroy(true);

            if ( !confirm ) return false;
        }
        
        // Some RGBA values are sometimes not 0 or 255.  
        this.#cleanPixels();

        if ( this.#isDebugging ) {
            const confirm = await this.#verifyPixels();
            if ( !confirm ) return false;
        }

        return true;
    }

    /**
     * Called by this.#getPixelData, this method cleans up occasional variances in the
     * RGBA values.  They should be 0 or 255, but occasionally can be between 0 and 5, or
     * 250 and 255.
     * @private
     */
    #cleanPixels() {
        for (let i=0; i < this.pixels.length; i+=4) {
            let R = this.pixels[i];
            let G = this.pixels[i+1];
            let B = this.pixels[i+2];
            let A = this.pixels[i+3];

            if ( R < 5 ) this.pixels[i] = 0
            else if ( R > 250 ) this.pixels[i] = 255;

            if ( G < 5 ) this.pixels[i+1] = 0
            else if ( G > 250 ) this.pixels[i+1] = 255;

            if ( B < 5 ) this.pixels[i+2] = 0
            else if ( B > 250 ) this.pixels[i+2] = 255;

            if ( A < 5 ) this.pixels[i+3] = 0
            else if ( A > 250 ) this.pixels[i+3] = 255;
        }
    }

    /**
     * Called by this.#getPixelData, only when debugging is turned on.
     * Method will count how many pixels have RGBA values that are not 0 or 255.
     * @private
     * @returns {boolean}               // True on success.
     */
    async #verifyPixels() {
        let pixelError = 0;

        for (let i=0; i < this.pixels.length; i+= 4) {
            const R = this.pixels[i];
            const G = this.pixels[i+1];
            const B = this.pixels[i+2];
            const A = this.pixels[i+3];

            if ( 
                (R !== 0 && R !== 255) ||
                (G !== 0 && G !== 255) ||
                (B !== 0 && B !== 255) ||
                (A !== 0 && A !== 255)
            ) pixelError += 1;
        }

        const confirm = await Dialog.confirm({
            title: "Review pixel errors.",
            content: `  <p>Pixel Errors: ${pixelError}.</p>
                        <p>Click YES to continue if there are no pixel errors.</p>
                        <p>Otherwise, click NO to abort.</p>`,
            yes: () => {return true},
            no: () => {return false}
        })

        if ( !confirm ) return false

        return true;
    }

    /**
     * Because the pixel data only contains black with zero alpha and white with 255 alpha,
     * it is possible to compress the data by having arrays that represent when the white
     * pixels start and end for every row and column.  This also makes it very convenient to
     * extract perimeter pixels from the data.
     * Data is saved to this.compressedPixelData
     * this.pixels is then set to undefined, to free up memory.
     * @private
     */
    #compressPixelDataTemp() {
        const d = canvas.dimensions;
        let isBlackX = true;  // use for column, ie: y = 0 to y = d.sceneHeight
        let isBlackY = true;  // use for row, ie: x = 0, x = d.sceneWidth

        for (let i=0; i < this.pixels.length; i+=4) {
            const pixelData = JSON.stringify([this.pixels[i], this.pixels[i+1], this.pixels[i+2], this.pixels[i+3]]);
            const pixelIsWhite = pixelData === "[255,255,255,255]";
            const pixelIsBlack = pixelData === "[0,0,0,0]";

            if ( isBlackX && pixelIsWhite ) {
                // This column is encountering a transition from black to white.  Need to add a new array.

            }
        }
    }
    #compressPixelData() {
        const d = canvas.dimensions;
        let isBlack = true;

        function _analyzePixels(isBlack, x, y, direction) {
            const pixelIndex = (( (y - d.paddingY) * d.sceneWidth + (x - d.paddingX) ) * 4);
            const key = direction === "vertical" ? x : y;
            const value = direction === "vertical" ? y : x;
            const pixelData = JSON.stringify([this.pixels[pixelIndex], this.pixels[pixelIndex+1], this.pixels[pixelIndex+2], this.pixels[pixelIndex+3]]);
            const pixelIsWhite = pixelData === "[255,255,255,255]";
            const pixelIsBlack = pixelData === "[0,0,0,0]";
            if ( isBlack && pixelIsBlack ) return isBlack;
            if ( !isBlack && pixelIsWhite ) return isBlack;
            if ( isBlack && pixelIsWhite ) {
                if ( this.compressedPixelData[direction].has(key) ) {
                    const toUpdate = this.compressedPixelData[direction].get(key);
                    toUpdate.push([value])
                    this.compressedPixelData[direction].set(key, toUpdate);
                } else this.compressedPixelData[direction].set(key, [[value]]);
            }

            if ( !isBlack && pixelIsBlack) {
                const toUpdate = this.compressedPixelData[direction].get(key);
                toUpdate[toUpdate.length-1].push(value);
                this.compressedPixelData[direction].set(key, toUpdate);
            }

            return !isBlack;
        }

        const analyzePixels = _analyzePixels.bind(this);

        for (let x = d.paddingX; x < (d.sceneWidth + d.paddingX); x++) {
            for (let y = d.paddingY; y < (d.sceneHeight + d.paddingY); y++) {
                isBlack = analyzePixels(isBlack, x, y, "vertical");
            }

            if ( !isBlack ) {
                const toUpdate = this.compressedPixelData.vertical.get(x);
                toUpdate[toUpdate.length-1].push(d.sceneHeight + d.paddingY);
                this.compressedPixelData.vertical.set(x, toUpdate);
                isBlack = !isBlack;
            }
        }

        isBlack = true;
        for (let y = d.paddingY; y < (d.sceneHeight + d.paddingY); y++) {
            for (let x = d.paddingX; x < (d.sceneWidth + d.paddingX); x++) {
                isBlack = analyzePixels(isBlack, x, y, "horizontal");
            }

            if ( !isBlack ) {
                const toUpdate = this.compressedPixelData.horizontal.get(y);
                toUpdate[toUpdate.length-1].push(d.sceneWidth + d.paddingX);
                this.compressedPixelData.horizontal.set(y, toUpdate);
                isBlack = !isBlack;
            }
        }

        this.pixels = undefined;
    }

    /**
     * Iterates through every wall in this.instanceWalls to extract the coordinates
     * at each end of the wall, then add them to this.vertexCoords (as strings)
     * @private
     * @returns {boolean}                       // True on success.
     */
    async #extractVerticesFromWalls() {
        for (const [id, wall] of this.instanceWalls) {
            this.vertexCoords.add(JSON.stringify([wall.data.c[0], wall.data.c[1]]));
            this.vertexCoords.add(JSON.stringify([wall.data.c[2], wall.data.c[3]]));
        }

        if ( this.#isDebugging ) {
            const d = canvas.dimensions;
            const tempContainer = new PIXI.Container();
            for (let coord of this.vertexCoords) {
                const coords = JSON.parse(coord);
                const vertexDot = new PIXI.LegacyGraphics();
                vertexDot.beginFill(0xFFE97F);
                vertexDot.drawCircle(coords[0],coords[1], 15);
                vertexDot.endFill();
                tempContainer.addChild(vertexDot)            
            }

            canvas.stage.addChild(tempContainer);

            const confirm  = await Dialog.confirm({
                title: "Review Vertices extracted from wall data.",
                content: "<p>Click YES to continue if vertices are correct.</p><p>Otherwise, click NO to abort execution.</p>",
                yes: () => {return true},
                no: () => {return false}
            })

            canvas.stage.removeChild(tempContainer);
            tempContainer.destroy(true);

            if ( !confirm ) return false
        }

        return true;
    }

    #pixelIsExplored(x, y) {
        if ( this.compressedPixelData.vertical.has(x) ) {
            const compressedY = this.compressedPixelData.vertical.get(x);  // this is an array of arrays.
            for (const arrY of compressedY) {
                if ( y >= arrY[0] && y <= arrY[1] ) return true;
            }
        }
        if ( this.compressedPixelData.horizontal.has(y) ) {
            const compressedX = this.compressedPixelData.horizontal.get(y); // this is an array of arrays.
            for (const arrX of compressedX) {
                if ( x >= arrX[0] && x <= arrX[1] ) return true;
            }
        }
        return false
    }

    async #removeDanglingWalls() {
        const d = canvas.dimensions;
        for (const [id, wall] of this.instanceWalls) {
            for (let i=0; i < wall.data.c.length; i+= 2) {
                const row = wall.data.c[i+1];
                const column = wall.data.c[i]; 
                const checkisExplored = this.#pixelIsExplored(column, row);
                if ( !checkisExplored ) {
                    this.omitWalls.add(wall);
                    this.instanceWalls.delete(id);
                    this.vertexCoords.delete(JSON.stringify([column, row]));
                    break;
                }
            }
        }

        if ( this.#isDebugging ) {
            const d = canvas.dimensions;
            const tempContainer = new PIXI.Container();
            for (let coord of this.vertexCoords) {
                const coords = JSON.parse(coord);
                const vertexDot = new PIXI.LegacyGraphics();
                vertexDot.beginFill(0xFFE97F);
                vertexDot.drawCircle(coords[0],coords[1], 15);
                vertexDot.endFill();
                tempContainer.addChild(vertexDot)            
            }

            canvas.stage.addChild(tempContainer);

            const confirm  = await Dialog.confirm({
                title: "Review Vertices after dangling walls removed.",
                content: "<p>Click YES to continue if vertices are correct.</p><p>Otherwise, click NO to abort execution.</p>",
                yes: () => {return true},
                no: () => {return false}
            })

            canvas.stage.removeChild(tempContainer);
            tempContainer.destroy(true);

            if ( !confirm ) return false
        }
        
        return true;
    }

    async #extractPerimeterPixels() {
        for (const [key, value] of this.compressedPixelData.vertical) {
            for (const arr of value) {
                this.perimeterPixels.add(JSON.stringify([key, arr[0]]));
                this.perimeterPixels.add(JSON.stringify([key, arr[1]]));
            }
        }

        for (const [key, value] of this.compressedPixelData.horizontal) {
            for (const arr of value) {
                this.perimeterPixels.add(JSON.stringify([arr[0], key]));
                this.perimeterPixels.add(JSON.stringify([arr[1], key]));
            }
        }

        if ( this.#isDebugging ) {
            const d = canvas.dimensions;
            const tempContainer = new PIXI.Container();
            for (let coord of this.perimeterPixels) {
                const coords = JSON.parse(coord);
                const pixelDot = new PIXI.LegacyGraphics();
                pixelDot.beginFill(0xFF0000);
                pixelDot.drawCircle(coords[0],coords[1], 2);
                pixelDot.endFill();
                tempContainer.addChild(pixelDot)            
            }

            canvas.stage.addChild(tempContainer);

            const confirm  = await Dialog.confirm({
                title: "Review Perimeter Pixels.",
                content: "<p>Click YES to continue if perimeter is correct.</p><p>Otherwise, click NO to abort execution.</p>",
                yes: () => {return true},
                no: () => {return false}
            })

            canvas.stage.removeChild(tempContainer);
            tempContainer.destroy(true);

            if ( !confirm ) return false
        }
        
        return true;
    }

    async #removeInteriorWallsVertices() {
        /**
         * The vertices needed by the Texture2Polygon class/algorithm is only interested in 
         * walls that lie on the perimeter of the explored area.  The inside walls will be needed
         * later when recreating the sub-scene, so they can't be deleted from this.instanceWalls.
         * However, the vertices are not needed and have to be removed so follow-up algorithms can
         * begin to chain the vertices in a sequence that outlines the perimeter of the explored area.
         * 
         * The logic to define how this algorithm knows a vertex belongs to an interior wall will rely on the
         * individual pixel points stored in this.perimeterPixels.  If each coordinate of a vertex has
         * a corresponding perimeterPixel, then it is an outside vertex and has to remain.
         */

        const d = canvas.dimensions;

        for (const vertex of this.vertexCoords) {
            // vertex is relative to 0,0.  It needs to be adjusted by scene padding.
            const vert = JSON.parse(vertex);
            const check = this.perimeterPixels.has(vertex);
            if ( !check ) {
                /**
                 * Unfortunately, there are occasional corners where a vertex does belong to the perimeter,
                 * but there is no perimeter pixel.  To identify these, will examine adjacent pixels. 
                 * If we find an adjacent perimeter pixel, then this is one of those cases.  We'll add that
                 * pixel to this.perimeterPixels and continue on.
                 * If we don't find any adjacent pixels (there should be no walls 1 pixel long), then we remove
                 * that vertex.
                 */
                const pixelOffset = [-1,0,1];
                let foundPerimeterPixel = false;
                for (const offsetX of pixelOffset) {
                    if ( foundPerimeterPixel ) continue;
                    for (const offsetY of pixelOffset) {
                        if ( foundPerimeterPixel ) continue;
                        if ( offsetX === 0 && offsetY === 0) continue;
                        const offsetPixel = [vert[0] + offsetX, vert[1] + offsetY];
                        foundPerimeterPixel = this.perimeterPixels.has(JSON.stringify(offsetPixel));
                        if ( foundPerimeterPixel ) this.perimeterPixels.add(vertex);

                    }
                }
                if ( !foundPerimeterPixel ) {
                    // Find walls with this vertex to add them to this.omitWalls
                    for (const [id, wall] of this.instanceWalls) {
                        const c1 = JSON.stringify([wall.data.c[0], wall.data.c[1]]);
                        const c2 = JSON.stringify([wall.data.c[2], wall.data.c[3]]);
                        if ( c1 === vertex || c2 === vertex ) this.omitWalls.add(wall);
                    }
                    this.vertexCoords.delete(vertex);
                }
            }
        }

        if ( this.#isDebugging ) {
            const d = canvas.dimensions;
            const tempContainer = new PIXI.Container();
            tempContainer.x = d.paddingX;
            tempContainer.y = d.paddingY;
            for (let coord of this.vertexCoords) {
                const coords = JSON.parse(coord);
                const vertexDot = new PIXI.LegacyGraphics();
                vertexDot.beginFill(0xFFE97F);
                vertexDot.drawCircle(coords[0]-d.paddingX,coords[1]-d.paddingY, 15);
                vertexDot.endFill();
                tempContainer.addChild(vertexDot)            
            }

            canvas.stage.addChild(tempContainer);

            const confirm  = await Dialog.confirm({
                title: "Review Vertices after interior vertices removed.",
                content: "<p>Click YES to continue if vertices are correct.</p><p>Otherwise, click NO to abort execution.</p>",
                yes: () => {return true},
                no: () => {return false}
            })

            canvas.stage.removeChild(tempContainer);
            tempContainer.destroy(true);

            if ( !confirm ) return false
        }
        
        return true;
    }

    #linkVerticesByWalls() {
        /**
         * By the time this function should be called, this.vertexCoords should be an array
         * containing strings of coordinates in array form, ie: ["[100,100]", "[200,200]", etc...].
         * This function will mutate this.vertexCoords to begin linking coordinates to each other
         * using wall info from this.instanceWalls.
         * The link info for coordinates will be stored as objects in an array with the following
         * object definition:
         *      vertexCoord = {
         *          coord: <string>,
         *          walls: <array of wall documents>,
         *          first: <coord of fist wall>,
         *          second: <coord of second wall>
         *      }
         * Mutating this.vertexCoords at this stage because the dangling walls and interior wall
         * vertices have to be removed before this begins to make sense.  IE:  should only be
         * linking walls on the perimeter of the explored area.
         */

        // Step 1: Populate the object coord string and walls array.
        const newVertexArray = [];
        for (const vertexString of this.vertexCoords) {
            const obj = {
                coord: vertexString,
                walls: [],
                first: undefined,
                second: undefined
            }
            for (const [id, wall] of this.instanceWalls) {
                const c1 = JSON.stringify([wall.data.c[0], wall.data.c[1]]);
                const c2 = JSON.stringify([wall.data.c[2], wall.data.c[3]]);

                if ( vertexString === c1 || vertexString === c2) {
                    if ( this.omitWalls.has(wall) ) continue;
                    obj.walls.push(wall)
                }
            }

            newVertexArray.push(obj);
        }

        // Step 2: Link walls
        for (const vertexObj of newVertexArray) {

            for (let i=0; i < vertexObj.walls.length; i++) {
                const wall = vertexObj.walls[i];
                const c1 = [wall.data.c[0], wall.data.c[1]];
                const c2 = [wall.data.c[2], wall.data.c[3]];
                if ( vertexObj.first === undefined ) {
                    vertexObj.first = JSON.stringify(c1) === vertexObj.coord ? c2 : c1
                    continue;
                }
                vertexObj.second = JSON.stringify(c1) === vertexObj.coord ? c2 : c1
            }
        }

        // Mutate this.vertexCoord.
        this.vertexCoords = newVertexArray;
    }

    async #removeSameSlopeVertices() {

        function slope(a, b) {
            return ( (a[1]-b[1]) / (a[0]-b[0]) )
        }

        const startingVertex = this.vertexCoords.filter(v => v.first === undefined || v.second === undefined);
        let v0 = startingVertex[0];
        let v1 = this.vertexCoords.filter(v => v.coord === JSON.stringify(v0.first))[0];
        let nextVertex = JSON.stringify(v1.first) === v0.coord ? v1.second : v1.first;
        let v2 = this.vertexCoords.filter(v => v.coord === JSON.stringify(nextVertex))[0];

        do {
            // Slopes
            const v0v1 = slope(JSON.parse(v0.coord), JSON.parse(v1.coord));
            const v1v2 = slope(JSON.parse(v1.coord), JSON.parse(v2.coord));

            if ( v0v1 === v1v2) {
                // Point V1 is on a straight line between v0 and v2.  Remove v1 and update the links.
                if ( JSON.stringify(v0.first) === v1.coord ) v0.first = JSON.parse(v2.coord);
                else v0.second = JSON.parse(v2.coord);

                if ( JSON.stringify(v2.first) === v1.coord ) v2.first = JSON.parse(v0.coord);
                else v2.second = JSON.parse(v0.coord);

                const index = this.vertexCoords.findIndex(e => e === v1);
                this.vertexCoords.splice(index, 1);

                v1 = v2;
                nextVertex = JSON.stringify(v1.first) === v0.coord ? v1.second : v1.first;
                v2 = this.vertexCoords.filter(v => v.coord === JSON.stringify(nextVertex))[0];
            } else {
                v0 = v1;
                v1 = v2;
                nextVertex = JSON.stringify(v1.first) === v0.coord ? v1.second : v1.first;
                v2 = this.vertexCoords.filter(v => v.coord === JSON.stringify(nextVertex))[0];
            }

        } while ( !startingVertex.includes(v1) )

        if ( this.#isDebugging ) {
            const d = canvas.dimensions;
            const tempContainer = new PIXI.Container();
            tempContainer.x = d.paddingX;
            tempContainer.y = d.paddingY;
            for (let obj of this.vertexCoords) {
                const coords = JSON.parse(obj.coord);
                const vertexDot = new PIXI.LegacyGraphics();
                vertexDot.beginFill(0xFFE97F);
                vertexDot.drawCircle(coords[0]-d.paddingX,coords[1]-d.paddingY, 15);
                vertexDot.endFill();
                tempContainer.addChild(vertexDot)            
            }

            canvas.stage.addChild(tempContainer);

            const confirm  = await Dialog.confirm({
                title: "Review Vertices after inline vertices removed.",
                content: "<p>Click YES to continue if vertices are correct.</p><p>Otherwise, click NO to abort execution.</p>",
                yes: () => {return true},
                no: () => {return false}
            })

            canvas.stage.removeChild(tempContainer);
            tempContainer.destroy(true);

            if ( !confirm ) return false
        }
        
        return true;
    }

    /** 
     * Add vertices that are present on the perimeter of the image.  But there's a GOTCHA here...
     * To explain, assume an image that is 100 pixels by 100 pixels.
     * 
     * The vertices populated from wall data use a coordinate system that snaps to the top left of a given pixel.
     * Assuming walls are placed on the boundaries to encapsulate the image pixels:
     *   The top left [1,1] pixel of the image will have a wall coordinate of [0,0]
     * 
     *   The bottom right [100,100] pixel of the image will have a wall coordinate of [101,101]
     *   If the bottom right wall coordinate was [100,100], and wall coordinates snap to the top left corner of a given pixel,
     *   then the boundary wall on the bottom and right would be missing the 100th row and 100th column of pixels.
     * 
     * This means when we search the compressedPixelData, we have to use wall coordinates because that's how it's been stored
     * up to this point.
     * However, once the compressedPixelData provides the information we need, for cases where x = sceneWidth and y = sceneHeight,
     * we need to add 1 to bump the wall coordinate to the other side of the pixel.
     */
    async #addBoundaryVertices() {
        const d = canvas.dimensions;
        const boundaries = [["horizontal", [d.paddingY, d.sceneHeight + d.paddingY - 1]], ["vertical", [d.paddingX, d.sceneWidth + d.paddingX - 1]]];

        for (const boundary of boundaries) {
            for (const bounds of boundary[1]) {
                if ( this.compressedPixelData[boundary[0]].has(bounds) ) {
                    const boundarySegments = this.compressedPixelData[boundary[0]].get(bounds); // Array of arrays.
                    let coord1 = [];
                    let coord2 = [];
                    for (const segment of boundarySegments) {
                        // This is where we figure out if x = sceneWidth or y = sceneHeight and add 1.
                        if ( bounds === boundary[1][1] ) {
                            coord1 = boundary[0] === "horizontal" ? [segment[0], bounds + 1] : [bounds + 1, segment[0]];
                            coord2 = boundary[0] === "horizontal" ? [segment[1], bounds + 1] : [bounds + 1, segment[1]];
                        } else {
                            coord1 = boundary[0] === "horizontal" ? [segment[0], bounds] : [bounds, segment[0]];
                            coord2 = boundary[0] === "horizontal" ? [segment[1], bounds] : [bounds, segment[1]];
                        }
                        const coords = [coord1, coord2];
                        for (const coord of coords) {
                            const otherCoord = JSON.stringify(coord) === JSON.stringify(coord1) ? coord2 : coord1
                            const vertex = this.vertexCoords.filter(v => v.coord === JSON.stringify(coord))  // An array  
                            if ( vertex.length ) {
                                // This vertex exists.  It should have an undefined second field...
                                if ( vertex[0].second !== undefined) {
                                    ui.notifications.error("Trying to add boundary vertex, but this vertex already fully defined.  See console.");
                                    log(false, [vertex[0]]);
                                    return false
                                } else {
                                    vertex[0].second = otherCoord;
                                    continue;
                                }
                            }
                            // This vertex doesn't exist.
                            this.vertexCoords.push({
                                coord: JSON.stringify(coord),
                                walls: [],
                                first: otherCoord,
                                second: undefined
                            })
                        }
                    }
                }
            }
        }

        if ( this.#isDebugging ) {
            const tempContainer = new PIXI.Container();
            for (let obj of this.vertexCoords) {
                const coords = JSON.parse(obj.coord);
                const vertexDot = new PIXI.LegacyGraphics();
                vertexDot.beginFill(0xFFE97F);
                vertexDot.drawCircle(coords[0],coords[1], 15);
                vertexDot.endFill();
                tempContainer.addChild(vertexDot)            
            }

            canvas.stage.addChild(tempContainer);

            const confirm  = await Dialog.confirm({
                title: "Review after boundary vertices added.",
                content: "<p>Click YES to continue if vertices are correct.</p><p>Otherwise, click NO to abort execution.</p>",
                yes: () => {return true},
                no: () => {return false}
            })

            canvas.stage.removeChild(tempContainer);
            tempContainer.destroy(true);

            if ( !confirm ) return false
        }
        
        return true;
    }

    #linkFinalVertices() {

        function _isPerimeter(x, y) {
            const pixelOffset = [-1,0,1];
            for (const offsetX of pixelOffset) {
                for (const offsetY of pixelOffset) {
                    const offsetPixel = [x + offsetX, y + offsetY];
                    if ( this.perimeterPixels.has(JSON.stringify(offsetPixel)) ) return true;
                }
            }
            return false
        }

        function link(v1, v2) {
            v1.second = JSON.parse(v2.coord);
            v2.second = JSON.parse(v1.coord);
        }

        const isPerimeter = _isPerimeter.bind(this);
        
        // Find all vertices that are not connected
        let unlinkedVertices = this.vertexCoords.filter(v => v.first === undefined || v.second === undefined);
        if ( !unlinkedVertices.length ) return;
        do {
            if ( unlinkedVertices.length > 2 ) {
                // Doesn't matter which we start with.  Grab the first one.
                const vert1 = unlinkedVertices[0];
                const P1 = JSON.parse(vert1.coord);
                let update = false;
                // Now check the other vertices to see if P1 is connected to one.
                for (const vert of unlinkedVertices) {
                    if ( update ) continue;
                    if ( vert === vert1 ) continue;
                    const P2 = JSON.parse(vert.coord);
                    const slope = (P2[1] - P1[1]) / (P2[0] - P1[0]);
                    if ( isFinite(slope) ) { // infinite slopes are a special case (ie: vertical line).  
                        // Equation of a line: y = mx + b, where m = slope and b = y intercept @ x=0
                        // To find b given a point we know: b = y - mx
                        const b = Math.round(P1[1] - slope * P1[0]);
                        // Now, want three X values: at a point 25%, 50% & 75% of the distance between the vertices.
                        const v50x = Math.round((P2[0] - P1[0]) / 2) + P1[0];
                        const v25x = Math.round((v50x - P1[0]) / 2) + P1[0];
                        const v75x = Math.round((P2[0] - v50x) / 2) + v50x;
                        // Find y values for each x value
                        const v25y = Math.round(slope * v25x + b);
                        const v50y = Math.round(slope * v50x + b);
                        const v75y = Math.round(slope * v75x + b);
                        // Ping each pixel around this coordinate to see if the coordinate is on the perimeter
                        const is25 = isPerimeter(v25x, v25y);
                        const is50 = isPerimeter(v50x, v50y);
                        const is75 = isPerimeter(v75x, v75y);

                        if ( !is25 || !is50 || !is75 ) continue;

                        update = true;
                    } else {
                        // Deal with vertical line.
                        const v50y = Math.round((P2[1] - P1[1]) / 2) + P1[1];
                        const v25y = Math.round((v50y - P1[1]) / 2) + P1[1];
                        const v75y = Math.round((P2[1] - v50y) / 2) + v50y;
                        // Ping each pixel around this coordinate to see if the coordinate is on the perimeter
                        const is25 = isPerimeter(P1[0], v25y);
                        const is50 = isPerimeter(P1[0], v50y);
                        const is75 = isPerimeter(P1[0], v75y);

                        if ( !is25 || !is50 || !is75 ) continue;

                        update = true;
                    }

                    if ( update ) link(vert1, vert)
                }
            } else {
                // Only two left.
                link(unlinkedVertices[0], unlinkedVertices[1]);
            }

            unlinkedVertices = this.vertexCoords.filter(v => v.first === undefined || v.second === undefined);

        } while ( unlinkedVertices.length )
    }

    /** Foundry core's drawing polygon method requires an ordered series of point coordinates in array form, ie: [0,0]
     *  It also normalizes the data points relative to the top left corner of a bounding box that contains all the vertices.
     *  Need an array of normalized vertex points, ordered such that the points define a perimeter and end at the same
     *  coordinate it started.
     * @return {promise}      
     */
     async #prepareVertexData() {

        const orderedArray = [];
        const d = canvas.dimensions;
        const smallestX = this.vertexCoords.reduce((pv, cv) => Math.min(pv, JSON.parse(cv.coord)[0]), d.sceneWidth + d.paddingX + 1);
        const smallestY = this.vertexCoords.reduce((pv, cv) => Math.min(pv, JSON.parse(cv.coord)[1]), d.sceneHeight + d.paddingY + 1);
        const largestX = this.vertexCoords.reduce((pv, cv) => Math.max(pv, JSON.parse(cv.coord)[0]), 0);
        const largestY = this.vertexCoords.reduce((pv, cv) => Math.max(pv, JSON.parse(cv.coord)[1]), 0);
        this.boundingBox = {
            x: smallestX,
            y: smallestY,
            width: largestX - smallestX,
            height: largestY - smallestY,
            center: {
                x: (largestX - smallestX) / 2,
                y: (largestY - smallestY) / 2
            }
        }

        // To make sure the array is ordered, going to need to manually initialize the array with the first two coordinates
        orderedArray.push(JSON.parse(this.vertexCoords[0].coord));
        orderedArray.push(this.vertexCoords[0].first);

        // The function that will iterate over all the vertices to find the next one.
        function _orderVertices() {
            const vertexData = this.vertexCoords.filter(v => v.coord === JSON.stringify(orderedArray[orderedArray.length - 1]))[0];
            return JSON.stringify(vertexData.first) === JSON.stringify(orderedArray[orderedArray.length - 2]) ? vertexData.second : vertexData.first;
        }

        const orderVertices = _orderVertices.bind(this);

        do {
            orderedArray.push(orderVertices());
        } while (JSON.stringify(orderedArray[0]) !== JSON.stringify(orderedArray[orderedArray.length - 1]));

        // Now normalize the array coordinates relative to the bounding box top left corner.

        const normalizedArray = orderedArray.map(coord => {
            return [coord[0] - smallestX, coord[1] - smallestY];
        })

        this.polygonVertexCoordinates =  normalizedArray;

        if ( this.#isDebugging ) {
            const d = canvas.dimensions;
            let points = []
            for (const pt of this.polygonVertexCoordinates) {
                points = [...points, ...pt];
            }
            const poly = new PIXI.Polygon(points);
            const graphics = new PIXI.LegacyGraphics();
            graphics.x = smallestX;
            graphics.y = smallestY;
            graphics.beginFill(0xFF0000, .5);
            graphics.drawPolygon(poly);
            graphics.endFill();
            canvas.stage.addChild(graphics);

            const confirm  = await Dialog.confirm({
                title: "Review perimeter generated from vertices.",
                content: "<p>Click YES to continue if the perimeter is correct.</p><p>Otherwise, click NO to abort execution.</p>",
                yes: () => {return true},
                no: () => {return false}
            })

            canvas.stage.removeChild(graphics);
            graphics.destroy(true);

            if ( !confirm ) return false
        }
        
        return true;
    }

    getColor(box) {
        // Define a color using RGB.
        // The R value is interpolated between x=0/R=0 : x=sceneWidth/R=255
        // The G value is interpolated between y=0/G=0 : y=sceneHeight/G=255

        // The scene would be colored sufficiently with simply R & G values, BUT!
        // if the scene is larger than 255 x 255, then the interpolation will result in
        // blocks of the same color.  A kind of a pixelation.

        // So, use the B value to break those blocks up further.  
        // The B value is interpolated from the center of the scene to the pixel, where max B = 255
        // is the distance from the center to the corners.

        function lineLength(P1, P2) {
            return Math.sqrt(Math.pow((P1.x - P2.x),2) + Math.pow((P1.y - P2.y), 2));
        }

        const d = canvas.dimensions;
        const sceneCenter = {
            x: d.sceneWidth / 2,
            y: d.sceneHeight / 2
        }
        const R = Math.round((box.center.x / d.sceneWidth) * 255);
        const G = Math.round((box.center.y / d.sceneHeight) * 255);
        const maxB = lineLength(sceneCenter, {x: 0, y: 0});
        const B = Math.round((lineLength(sceneCenter, box.center) / maxB) * 255);
                                
        // Have to convert RGB to HEX.  Found at https://stackoverflow.com/questions/5623838/rgb-to-hex-and-hex-to-rgb
        const rbgToHex = (R, G, B) => '#' + [R, G, B].map(x => {
            const hex = x.toString(16);
            return hex.length === 1 ? '0' + hex : hex;
        }).join('');
        return rbgToHex(Math.round(R), Math.round(G), Math.round(B));
    }

    async #generateDrawingPolygon() {

        function _getNewDrawingData(origin) {
             // Get saved user defaults
            const defaults = game.settings.get("core", "defaultDrawingConfig") || {};
            const data = foundry.utils.mergeObject(defaults, {
                text: this.subSceneName,
                textColor: '#000000',
                fillType: 1,
                fillColor: this.drawingColor || game.user.color,
                strokeColor: this.drawingColor || game.user.color,
                fontFamily: CONFIG.defaultFontFamily
            }, {overwrite: false, inplace: false});

            // Mandatory additions
            data.x = Math.round(origin.x);
            data.y = Math.round(origin.y);
            data.author = game.user.id;

            data.type = CONST.DRAWING_TYPES.POLYGON;
            data.points = [[origin.x - data.x, origin.y - data.y]];

            return data
        }

        const getNewDrawingData = _getNewDrawingData.bind(this);

        const d = canvas.dimensions;

        this.drawingColor = this.getColor(this.boundingBox)
        const document = new DrawingDocument(getNewDrawingData({x: this.boundingBox.x, y: this.boundingBox.y}), {parent: canvas.scene});
        let drawingDoc = new Drawing(document);
        drawingDoc.data.points = this.polygonVertexCoordinates;

        const data = drawingDoc.data.toObject(false);
        const cls = getDocumentClass("Drawing");
        const createData = Drawing.normalizeShape(data);
        const drawing = await cls.create(createData, {parent: canvas.scene});
        const o = drawing.object;
        o._creating = true;
        o._pendingText = "";
        o.control({isNew: true});
        o._controlled = false;
        o._onControl();

        return o.data._id
    }
}
