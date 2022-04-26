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
        const smallestX = this.vertexCoords.reduce((pv, cv) => Math.min(pv, JSON.parse(cv.coord)[0]), d.sceneWidth + d.paddingX);
        const smallestY = this.vertexCoords.reduce((pv, cv) => Math.min(pv, JSON.parse(cv.coord)[1]), d.sceneHeight + d.paddingY);

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
}

export class OldTexture2Polygon {
    constructor(name, walls) {
        this.subSceneName = name;
        this.id = foundry.utils.randomID(16);
        this.texDebugContainer = new PIXI.Container();
        this.pixelsDebugContainer = new PIXI.Container();
        this.tex = null;
        this.perimeterPixels = null;
        this.vertices = new Map();
        this.isBoundingBoxDone = false;
        this.boundingBox = {};
        this.drawingID = "";
        this.drawingColor = undefined;
        this.pixels = undefined;
        this.instanceVertices = new Set();
        this.instanceWalls = walls;
        this.alphaThreshold = 100;
    }

    async generateDrawingPolygon() {
        this.tex = this.getTexWithAlpha(); 
        this.perimeterPixels = new Set(this.getPerimeterPixelsFromTexture(this.tex));
        //this.filterDanglingWalls();
        this.extractVerticesFromWalls();
        this.testVertices();
        //this.getVertices();
        //this.drawingID = await this._generateDrawingPolygon();
    }

    filterDanglingWalls() {
        const d = canvas.dimensions;
        for (const [id, wall] of this.instanceWalls) {
            for (let i=0; i < wall.data.c.length - 2; i+= 2) {
                const row = wall.data.c[i+1] - d.paddingY;
                const column = wall.data.c[i] - d.paddingX; 
                const alphaIndex = ((row * d.sceneWidth + column) * 4) + 3;
                const checkisTransparent = this.pixels[alphaIndex] < this.alphaThreshold;
                if ( checkisTransparent ) {
                    this.instanceWalls.delete(id);
                    break;
                }
            }
        }
    }

    extractVerticesFromWalls() {
        for (const [id, wall] of this.instanceWalls) {
            this.instanceVertices.add(JSON.stringify([wall.data.c[0], wall.data.c[1]]));
            this.instanceVertices.add(JSON.stringify([wall.data.c[2], wall.data.c[3]]));
        }
    }

    testVertices() {
        const d = canvas.dimensions;
        for ( let coord of this.instanceVertices) {
            const coords = JSON.parse(coord);
            const vertexDot = new PIXI.LegacyGraphics();
            vertexDot.beginFill(0xFFE97F);
            vertexDot.drawCircle(coords[0]-d.paddingX,coords[1]-d.paddingY, 15);
            vertexDot.endFill();
            this.pixelsDebugContainer.addChild(vertexDot);
        }
    }


    get #isDebugging() {
        return game.modules.get('_dev-mode')?.api?.getPackageDebugValue(ModuleName);
    }

    getTexWithAlpha() {

        const d = canvas.dimensions;

        // texSprite is the saved explored texture.  It is black with white showing the explored areas.
        const texSprite = new PIXI.Sprite(canvas.sight.saved.texture);
        // whiteSprite is a new texture that is all white.  Will use texSprite to mask this white texture
        // The result will be replacing the black of texSprite with no color/zero alpha.
        const whiteSprite = new PIXI.Sprite(PIXI.Texture.WHITE);
        // PIXI.Texture.WHITE is 16x16.  Have to stretch it to fill the container.
        whiteSprite.width = d.sceneWidth;
        whiteSprite.height = d.sceneHeight;
        
        const texContainer = new PIXI.Container();
        texContainer.addChild(whiteSprite);
        texContainer.addChild(texSprite);
        texContainer.mask = texSprite;

        // Create a texture from texContainer
        const texture = PIXI.RenderTexture.create({
            width: d.sceneWidth,
            height: d.sceneHeight,
            scaleMode: PIXI.SCALE_MODES.LINEAR,
            resolution: 2
        })
        canvas.app.renderer.render(texContainer, texture);

        const newTexSprite = new PIXI.Sprite(texture);
        this.texDebugContainer.addChild(newTexSprite);
        this.texDebugContainer.x = d.paddingX;
        this.texDebugContainer.y = d.paddingY;
        canvas.stage.addChild(this.texDebugContainer);

        return texture;
    }

    getPerimeterPixelsFromTexture() {

        const d = canvas.dimensions;
        const perimeterPixels = new Set();
        this.pixels = canvas.app.renderer.extract.pixels(this.texDebugContainer);
        canvas.stage.addChild(this.pixelsDebugContainer);
        this.pixelsDebugContainer.x = d.paddingX;
        this.pixelsDebugContainer.y = d.paddingY;


        function _notIsTransparent(set, x, y, vertical = true) {
            const d = canvas.dimensions;
            let offset = isTransparent ? (vertical ? y : x) : (vertical ? y - 1 : x - 1);
            if (offset < 0) offset = 0;
            if ( vertical === true && y === d.sceneHeight) offset = y;
            if ( vertical === false && x === d.sceneWidth) offset = x;
            const coords = [(vertical ? x : offset), (vertical ? offset : y)];
            set.add(JSON.stringify(coords));
            if ( this.#isDebugging ) {
                const pixelDot = new PIXI.LegacyGraphics();
                pixelDot.beginFill(0xFF0000);
                pixelDot.drawCircle(coords[0],coords[1], 2);
                pixelDot.endFill();
                this.pixelsDebugContainer.addChild(pixelDot);
            }
            return !isTransparent;
        }

        const notIsTransparent = _notIsTransparent.bind(this);

        let isTransparent = true;

        for (let i = 0; i < d.sceneWidth; i++) {
            for (let j = 0; j < d.sceneHeight; j++) {
                const alphaIndex = ((j * d.sceneWidth + i) * 4) + 3;
                const checkisTransparent = this.pixels[alphaIndex] < this.alphaThreshold;
                isTransparent = isTransparent === checkisTransparent ? isTransparent : notIsTransparent(perimeterPixels, i, j, true);
            }

            if ( !isTransparent ) {
                isTransparent = notIsTransparent(perimeterPixels, i, d.sceneHeight, true);
            }
        }

        const smallY = [...perimeterPixels].reduce((prev, curr) => Math.min(prev, JSON.parse(curr)[1]), d.sceneWidth);
        const bigY = [...perimeterPixels].reduce((prev, curr) => Math.max(prev, JSON.parse(curr)[1]), 0);

        isTransparent = true;
        for (let j = smallY; j < bigY; j++) {
            for (let i = 0; i < d.sceneWidth; i++) {
                const alphaIndex = ((j * d.sceneWidth + i) * 4) + 3;
                const checkisTransparent = this.pixels[alphaIndex] < this.alphaThreshold;
                isTransparent = isTransparent === checkisTransparent ? isTransparent : notIsTransparent(perimeterPixels, i, j, false);
            }

            if ( !isTransparent ) {
                isTransparent = notIsTransparent(perimeterPixels, d.sceneWidth, j, false);
            }
        }

        this.texDebugContainer.alpha = 0;
        if ( this.#isDebugging ) {
            log(false, perimeterPixels);
            this.texDebugContainer.alpha = 0.75;
        }

        return [...perimeterPixels];
    }

    /** A function that uses various logic to find vertices in the premiterPixels Set.
     *  Once a vertex has been found, the points used to determine the location of that vertex
     *  are deleted from the perimeterPixels Set, the function returns and is called again.
     *  The function only exits completely without calling itself again when all logic has been executed
     *  and no more vertices were found.
     */
    _getVertices() {

        const d = canvas.dimensions;
        const edgeThreshold = 10; // minimum quantity of pixels to form an edge between vertices.
        let ptsBetweenVertices = [];

        //First pass is to simulate a bounding box by filtering for the largest X, smallest X, largest Y and smallest Y coordinates.
        //If either of those has only one coordinate, then it is either a point (definitely a vertex) or it is the tangent point of an arc (good enough to be a vertex).
        //If there are more than one points, then one of them is definitely a vertex.
        //If the bounding box filtering has been checked, skip this block on further iterations/recursions.
        if ( !this.isBoundingBoxDone ) {
            const largestX = [...this.perimeterPixels].reduce((previous, current) => {
                const coord = JSON.parse(current);
                return coord[0] > previous ? coord[0] : previous;
            }, 0);
            const smallestX = [...this.perimeterPixels].reduce((previous, current) => {
                const coord = JSON.parse(current);
                return coord[0] < previous ? coord[0] : previous;
            }, d.sceneWidth);
            const largestY = [...this.perimeterPixels].reduce((previous, current) => {
                const coord = JSON.parse(current);
                return coord[1] > previous ? coord[1] : previous;
            }, 0);
            const smallestY = [...this.perimeterPixels].reduce((previous, current) => {
                const coord = JSON.parse(current);
                return coord[1] < previous ? coord[1] : previous;
            }, d.sceneHeight);
            const smallestXArray = [...this.perimeterPixels].filter(coord => JSON.parse(coord)[0] === smallestX);
            const largestXArray = [...this.perimeterPixels].filter(coord => JSON.parse(coord)[0] === largestX);
            const smallestYArray = [...this.perimeterPixels].filter(coord => JSON.parse(coord)[1] === smallestY);
            const largestYArray = [...this.perimeterPixels].filter(coord => JSON.parse(coord)[1] === largestY);

            // The following is required later to create the drawing polygon
            this.boundingBox = {
                x0: smallestX,
                y0: smallestY,
                x1: largestX,
                y1: largestY,
                width: largestX - smallestX,
                height: largestY - smallestY
            }

            function _checkCoord(coord) {
                if ( this.perimeterPixels.has(JSON.stringify(coord)) ) {
                    this.vertices.set(JSON.stringify(coord), {first: null, second: null});
                    this.perimeterPixels.delete(JSON.stringify(coord))
                    log(false, ["Added vertex: ", coord])
                }
            }

            const checkCoord = _checkCoord.bind(this)

            // sXsY === smallestX_smallestY.  sXlY === smallestX_largestY. Etc..
            if ( smallestXArray.length === 1 ) {
                checkCoord(JSON.parse(smallestXArray[0]))
            } else {
                const sXsY = smallestXArray.reduce((previous, current) => {
                    const coord = JSON.parse(current);
                    return coord[1] < previous ? coord[1] : previous;
                }, d.sceneHeight);
                this.boundingBox.startPt = JSON.stringify([smallestX, sXsY]);
                const sXlY = smallestXArray.reduce((previous, current) => {
                    const coord = JSON.parse(current);
                    return coord[1] > previous ? coord[1] : previous;
                }, 0);
                checkCoord([JSON.parse(smallestXArray[0])[0], sXsY]);
                checkCoord([JSON.parse(smallestXArray[0])[0], sXlY]);
            }

            if ( largestXArray.length === 1 ) {
                checkCoord(JSON.parse(largestXArray[0]))
            } else {
                const lXsY = largestXArray.reduce((previous, current) => {
                    const coord = JSON.parse(current);
                    return coord[1] < previous ? coord[1] : previous;
                }, d.sceneHeight);
                const lXlY = largestXArray.reduce((previous, current) => {
                    const coord = JSON.parse(current);
                    return coord[1] > previous ? coord[1] : previous;
                }, 0);
                checkCoord([JSON.parse(largestXArray[0])[0], lXsY]);
                checkCoord([JSON.parse(largestXArray[0])[0], lXlY]);
            }

            if ( smallestYArray.length === 1 ) {
                checkCoord(JSON.parse(smallestYArray[0]))
            } else {
                const sYsX = smallestYArray.reduce((previous, current) => {
                    const coord = JSON.parse(current);
                    return coord[0] < previous ? coord[0] : previous;
                }, d.sceneHeight);
                const sYlX = smallestYArray.reduce((previous, current) => {
                    const coord = JSON.parse(current);
                    return coord[0] > previous ? coord[0] : previous;
                }, 0);
                checkCoord([sYsX, JSON.parse(smallestYArray[0])[1]]);
                checkCoord([sYlX, JSON.parse(smallestYArray[0])[1]]);
            }

            if ( largestYArray.length === 1 ) {
                checkCoord(JSON.parse(largestYArray[0]))
            } else {
                const lYsX = largestYArray.reduce((previous, current) => {
                    const coord = JSON.parse(current);
                    return coord[0] < previous ? coord[0] : previous;
                }, d.sceneHeight);
                const lYlX = largestYArray.reduce((previous, current) => {
                    const coord = JSON.parse(current);
                    return coord[0] > previous ? coord[0] : previous;
                }, 0);
                checkCoord([lYsX, JSON.parse(largestYArray[0])[1]]);
                checkCoord([lYlX, JSON.parse(largestYArray[0])[1]]);
            }

            this.isBoundingBoxDone = true;
        }

        // By this point, we should have several vertices.  We begin with the first vertex in the map, and check for:
        // Has it already been populated?  If so, skip to the next, otherwise
        // Does it have horizontal neighboring points (+ and -), OR
        // Does it have vertical neighboring points (+ and -)?
        // If we find neither horizontal or vertical neighbors, then we try the same for the next vertex.
        // When we run out of vertices, we move on.

        function _hasOrthoPixel(coord, dir, horizontal = true) {

            const x = horizontal ? dir : 0;
            const y = horizontal ? 0 : dir;
            const newCoord = [JSON.parse(coord)[0] + x, JSON.parse(coord)[1] + y];

            if ( this.perimeterPixels.has(JSON.stringify(newCoord)) ) {
                ptsBetweenVertices.push(newCoord);
                return hasOrthoPixel(JSON.stringify(newCoord), dir, horizontal);
            }

            return coord;
        }

        function _hasOrthoVertex(coord, dir, horizontal = true) {

            const x = horizontal ? dir : 0;
            const y = horizontal ? 0 : dir;
            const newCoord = [JSON.parse(coord)[0] + x, JSON.parse(coord)[1] + y];
            const hasVertex = this.vertices.get(JSON.stringify(newCoord));

            if ( hasVertex ) return JSON.stringify(newCoord);
            return false
        }

        const hasOrthoVertex = _hasOrthoVertex.bind(this);

        function _cleanUpPixels() {
            // Delete all the points between value and output
            for (const pts of ptsBetweenVertices) {
                if ( !this.perimeterPixels.delete(JSON.stringify(pts)) ) log(false, ["Tried to delete pixel point that didn't exist: ", pts]);
            }

            ptsBetweenVertices = [];
        }

        function _populateVertex(currentKey, currentValue, newCoord) {
                
            log(false, ["Updating vertex: ", currentKey]);
            if ( currentValue.first === null ) this.vertices.set(JSON.stringify(currentKey), {first: newCoord, second: null});
            else this.vertices.set(JSON.stringify(currentKey), {first: currentValue.first, second: newCoord});

            let otherVertex = null;
            if ( this.vertices.has(JSON.stringify(newCoord)) ) {
                log(false, ["Updating vertex: ", newCoord]);
                otherVertex = this.vertices.get(JSON.stringify(newCoord));
            } else {
                log(false, ["Adding vertex: ", newCoord]);
            }
            if ( otherVertex === null ) {
                this.vertices.set(JSON.stringify(newCoord), {first: currentKey, second: null});
            } else {
                if ( otherVertex.first === null ) this.vertices.set(JSON.stringify(newCoord), {first: currentKey, second: null});
                else this.vertices.set(JSON.stringify(newCoord), {first: otherVertex.first, second: currentKey});
            }
        }

        const hasOrthoPixel = _hasOrthoPixel.bind(this);
        const cleanUpPixels = _cleanUpPixels.bind(this);
        const populateVertex = _populateVertex.bind(this);

        for (const [key, value] of this.vertices) {
            // Has this vertex already been fully defined?
            if ( value.first !== null && value.second !== null) continue;

            const directions = [-1, 1];
            // Horizontal first
            for (const dir of directions) {
                const outputString = hasOrthoPixel(key, dir, true);
                if ( outputString === key ) continue;

                // Distance between the two coordinates
                const output = JSON.parse(outputString);
                const input = JSON.parse(key);
                const dist = Math.sqrt(Math.pow(output[0] - input[0], 2) + Math.pow(output[1] - input[1], 2));
                if ( dist < edgeThreshold ) {
                    ptsBetweenVertices = [];
                    continue;
                }

                // output is a new vertex, unless there is already a vertex at the next pixel.
                const adjacentVertex = hasOrthoVertex(outputString, dir, true);
                if ( adjacentVertex ) {
                    populateVertex(JSON.parse(key), value, JSON.parse(adjacentVertex));
                } else {
                    populateVertex(JSON.parse(key), value, JSON.parse(outputString));
                }

                cleanUpPixels();
                return false;

            }
            // Vertical next
            for (const dir of directions) {
                const outputString = hasOrthoPixel(key, dir, false);
                if ( outputString === key ) continue;

                // Distance between the two coordinates
                const output = JSON.parse(outputString);
                const input = JSON.parse(key);
                const dist = Math.sqrt(Math.pow(output[0] - input[0], 2) + Math.pow(output[1] - input[1], 2));
                if ( dist < edgeThreshold ) {
                    ptsBetweenVertices = [];
                    continue;
                }

                // output is a new vertex, unless there is already a vertex at the next pixel.
                const adjacentVertex = hasOrthoVertex(outputString, dir, false);
                if ( adjacentVertex ) {
                    populateVertex(JSON.parse(key), value, JSON.parse(adjacentVertex));
                } else {
                    populateVertex(JSON.parse(key), value, JSON.parse(outputString));
                }

                cleanUpPixels();
                return false;
            }
        }

        // At this point, we may have incomplete vertices and pixelPoints remaining.  Those points can 
        // represent angled lines, or curves.
        // Utility functions:

        function _getAdjacentPoint(vertex, wrong) {
            const pixelOffset = [-1, 0, 1];
            for (const offsetX of pixelOffset) {
                for (const offsetY of pixelOffset) {
                    if ( offsetX === 0 && offsetY === 0 ) continue;
                    const newCoord = [JSON.parse(vertex)[0] + offsetX, JSON.parse(vertex)[1] + offsetY];
                    if ( (JSON.stringify(newCoord) === wrong) ) continue;

                    if ( this.perimeterPixels.has(JSON.stringify(newCoord)) ) return newCoord;
                }
            }
            return false;
        }

        const getAdjacentPoint = _getAdjacentPoint.bind(this);

        function fillArray(arr) {

            let wrong = arr.length < 2 ? null : JSON.stringify(arr[arr.length - 2]);
            const newCoord = getAdjacentPoint(JSON.stringify(arr[arr.length - 1]), wrong);
            if ( newCoord === false ) return false;
            arr.push(newCoord);
            return true;
        }

        function iterateDistancesFromLine(trailingCar, leadCar, lastIndex, isMaybeVertex) {
            const O1 = {x: trailingCar[0][0], y: trailingCar[0][1]};
            const O2 = {x: leadCar[lastIndex][0], y: leadCar[lastIndex][1]};
            const joinedArray = [...trailingCar, ...leadCar];
            let largestDist = {
                dist: 0,
                point: null
            }

            for (const point of joinedArray) {
                const P = {x: point[0], y: point[1]};
                const nom = Math.abs((O2.x - O1.x)*(O1.y - P.y) - (O1.x - P.x)*(O2.y - O1.y));
                const denom = Math.sqrt(Math.pow((O2.x - O1.x),2) + Math.pow((O2.y - O1.y),2));
                const dist = nom / denom;
                if ( dist > largestDist.dist ) largestDist = {dist: dist, point: point};
            }

            if ( largestDist.dist < 1 ) return false;
            isMaybeVertex.add(largestDist.point);
            return true;
        }

        function findVertex(trailingCar, leadCar, lastIndex, isMaybeVertex) {
            // First, calculate the slopes for each array (each train car).  If the slopes are equal, move on.
            const slopeL = (trailingCar[lastIndex][1] - trailingCar[0][1])/(trailingCar[lastIndex][0] - trailingCar[0][0]);
            const slopeT = (leadCar[lastIndex][1] - leadCar[0][1])/(leadCar[lastIndex][0] - leadCar[0][0]);
            if ( slopeL !== slopeT || isMaybeVertex.size ) {
                // Now that the slopes are not equal, we may be turning a corner!
                const distCheck = iterateDistancesFromLine(trailingCar, leadCar, lastIndex, isMaybeVertex);
                if ( distCheck || isMaybeVertex.size ) {
                    // If isMaybeVertex has a size of 1 AND the entry is equal to the first index of the trailing car...
                    const [firstVertex] = isMaybeVertex;
                    if ( isMaybeVertex.size === 1 && JSON.stringify(firstVertex) === JSON.stringify(trailingCar[0])) {
                        ptsBetweenVertices.push(trailingCar[0]);
                        return "isVertex";
                    }
                    // Otherwise we need to move the train forward and recursively call findVertex() again.
                }
                // else it might just be the raster shifting x or y.  Proceed as if slopes are equal.
            }
            // In case we're encountering a curve?
            if ( isMaybeVertex.size > 1 ) return false;

            // The slopes are equal (ie: dist < 1), OR we need to keep checking the isMaybeVertex value...
            // Get a new point.
            const newPt = getAdjacentPoint(JSON.stringify(leadCar[lastIndex]), JSON.stringify(leadCar[lastIndex-1]));
            if ( newPt === false ) {
                return false;
            }
            // Transfer the first point in the second array (trailing car) to ptsBetweenVertices
            ptsBetweenVertices.push(trailingCar[0]);
            // Remove the first point in the second array (trailing car)
            trailingCar.shift();
            // Add the first point in the first array (lead car) to the second array (trailing car)
            trailingCar.push(leadCar[0]);
            // Remove the first point in the first array (lead car)
            leadCar.shift();
            // Add the new point to the first array (lead car)
            leadCar.push(newPt);
            // Recursively call this function again.
            return "iterate";
        }

        function _getAdjacentVertex(vertex) {
            const pixelOffset = [-1, 0, 1];
            for (const offsetX of pixelOffset) {
                for (const offsetY of pixelOffset) {
                    if ( offsetX === 0 && offsetY === 0 ) continue;
                    const newCoord = [JSON.parse(vertex)[0] + offsetX, JSON.parse(vertex)[1] + offsetY];
                    const foundVertex = this.vertices.get(JSON.stringify(newCoord));
                    if ( foundVertex && (foundVertex.first !== null || foundVertex.second !== null) ) return newCoord;
                }
            }
            return false;
        }

        const getAdjacentVertex = _getAdjacentVertex.bind(this);


        // The following block tries to find vertices for non-orthogonal straight series of points.
        // Best way to visualize this algorithm is:  
        //   - The points are a railway track
        //   - On this track, there are two train cars, connected together by a hinge.  These train cars are arrays
        //   - These train cars have a length in points (track) defined by the edgeThreshold variable, defined above.
        //   - All the points (track) covered by the arrays (train cars) belong to those arrays.
        //   - When the train cars are aligned on a straight track (their slopes are equal), we know there are no vertices to find
        //     in the points contained by the arrays, so we keep moving the train forward.
        //   - When the train moves forward, any points (track) that falls out of the second array (trailing car),
        //     gets saved to the ptsBetweenVertices, which collects points to be deleted once a vertex is found.
        //   - When the lead train car begins to go around a bend (a curve), the two cars are not aligned and we know to look for a vertex.
        //      - It may be a smooth curve (like an actual train track).  If this is the case, there is no vertex to find and
        //        that will be resolved in another block of code.  If we find this condition, we should move on.
        //      - It may be a sharp curve (doesn't work with the train track anology anymore, but humor me), and if this is the case, then 
        //        that corner is a vertex!
        //   - To find the vertex, we'll draw a line between the lead point in the first array (lead car) and the last point in the
        //     second array (trailing car).  Then we'll measure the distance of each point in both arrays from this new line.
        //      - If the distance is less than some threshold (probably less than 1 pixel), then we're just dealing with rasterization
        //        where pixels are shifting by one X and/or one Y.  We'll ignore these and move on.
        //      - If the distance for one or more pixels is/are greater than the threshold (probably more than 1 pixel), then we'll store
        //        the largest into a Set.  We use a Set because Set entries have to be unique, which we want to enforce.
        //      - A corner should always be the furthest point between the leading point of the first array and the trailing point of the
        //        second array regardless of where that corner is in either array.
        //   - We will keep moving forward until we end up with more than one entry in the Set, in which case we assume its a curve, OR
        //     there is only one entry in the set AND that entry becomes the first point in the second array (the trailing car).
        //      - When this condition is met, we create a vertex at that point.  Delete the points in ptsBetweenVertices and then
        //        return out of the function, which will get called again.

        if ( this.#isDebugging ) {
            log(false, this.perimeterPixels);
            log(false, this.vertices);
        }

        for (const [vertexCoord, value] of this.vertices) {
            // Has this vertex already been fully defined?
            if ( value.first !== null && value.second !== null) continue;

            ptsBetweenVertices = [];
            let leadCar = [];
            let trailingCar = [];
            const lastIndex = edgeThreshold - 1;
            let isMaybeVertex = new Set();
            let checkResult = false;

            // Create the first array (trailing car) leading away from the vertex being iterated upon.
            // Initialize the array by adding the first entry.
            let initialCoord = getAdjacentPoint(vertexCoord, null);
            trailingCar.push(initialCoord);
            // Now, fill it up
            do {
                checkResult = fillArray(trailingCar);
                if ( !checkResult ) break;
            } while ( trailingCar.length < edgeThreshold )

            if ( trailingCar.length === edgeThreshold ) {
                // Check to see if the line is horizontal or vertical (can happen if a corner is cut off)
                const slopeTrailingCar = (trailingCar[lastIndex][1] - trailingCar[0][1])/(trailingCar[lastIndex][0] - trailingCar[0][0]);
                // A slope === 0 (zero) means a horizontal line.
                // A slope === Infinity means a vertical line.
                if ( slopeTrailingCar === 0 || !isFinite(slopeTrailingCar) ) {
                    // Is horizontal or vertical, but wasn't orthogonal to the vertex.  IE: cut corner
                    // Update the vertex then iterate getVertices()
                    const dir = {
                        x: trailingCar[0][0] === trailingCar[lastIndex][0] ? (JSON.parse(vertexCoord)[0] < trailingCar[0][0] ? 1 : -1) : 0,
                        y: trailingCar[0][1] === trailingCar[lastIndex][1] ? (JSON.parse(vertexCoord)[1] < trailingCar[0][1] ? 1 : -1) : 0
                    }
                    const newCoord = [JSON.parse(vertexCoord)[0] + dir.x, JSON.parse(vertexCoord)[1] + dir.y];
                    const refVertex = this.vertices.get(JSON.stringify(value.first));
                    log(false, ["Updating vertex: ", refVertex.first]);
                    if ( JSON.stringify(refVertex.first) === JSON.stringify(vertexCoord))
                        this.vertices.set(JSON.stringify(value.first), {first: newCoord, second: refVertex.second});
                    else this.vertices.set(JSON.stringify(value.first), {first: refVertex.first, second: newCoord});
                    log(false, ["Creating vertex: ", newCoord]);
                    this.vertices.set(JSON.stringify(newCoord), {first: value.first, second: null});
                    log(false, ["Deleting vertex: ", vertexCoord]);
                    this.vertices.delete(vertexCoord);
                    return false;
                }

                // Create the second array (leading car) leading away from the first array (trailing car)
                // Initialize the array by adding the first entry.
                initialCoord = getAdjacentPoint(JSON.stringify(trailingCar[lastIndex]), JSON.stringify(trailingCar[lastIndex - 1]));
                leadCar.push(initialCoord);
                // Initializing a second point since it is possible and likely the array can be filled in the wrong direction.
                initialCoord = getAdjacentPoint(JSON.stringify(leadCar[0]), JSON.stringify(trailingCar[lastIndex]));
                leadCar.push(initialCoord);
                // Now, fill it up
                do {
                    checkResult = fillArray(leadCar);
                    if ( !checkResult ) break;
                } while ( leadCar.length < edgeThreshold )

                if ( leadCar.length === edgeThreshold ) {

                    // Now we start trying to find a vertex by moving the cars and looking for special cases.
                    let foundVertex = "";
                    do {
                        foundVertex = findVertex(trailingCar, leadCar, lastIndex, isMaybeVertex);
                    } while ( foundVertex === "iterate");
                    if ( !foundVertex ) {
                        if ( isMaybeVertex.size > 1 ) {
                            log(false, ["Suspects a curve.  Moving on to next vertex."])
                            // Step to the next known vertex
                            continue;
                        }
                        // There may be an adjacent Vertex
                        const checkVertex = getAdjacentVertex(JSON.stringify(leadCar[lastIndex]));
                        if ( checkVertex === false ) {
                            ui.notifications.error("Error. Reached end of points and found no neighboring vertex?");
                            log(false, ["Error.  Reached end of pixelPoints and found no neighboring vertex."]);
                            continue;
                        }
                        // Have to add leadCar and trailingCar's points to ptsBetweenVertices
                        ptsBetweenVertices = [...ptsBetweenVertices, ...leadCar, ...trailingCar];
                        cleanUpPixels();
                        populateVertex(JSON.parse(vertexCoord), value, checkVertex);
                        return false;
                    }
                    if ( foundVertex === "isVertex" ) {
                        cleanUpPixels();
                        populateVertex(JSON.parse(vertexCoord), value, trailingCar[0]);
                        return false;
                    }

                } else {
                    // Not enough points?  Check if there's a vertex
                    ui.notifications.error("Add code to check for vertex (leadCar).  Fewer points than edgeThreshold.");
                    log(false, ["Not enough pixel points to fill leadCar array when leaving from ", JSON.stringify(vertexCoord), " vertex."]);
                    break;
                }
            } else {
                // Not enough points?  Check if there's a vertex
                const checkVertex = getAdjacentVertex(vertexCoord);
                    if ( checkVertex === false ) {
                        ui.notifications.error("Error.  No points or not enough points left to define edge.");
                        log(false, ["Not enough pixel points to fill trailingCar array when leaving from ", JSON.stringify(vertexCoord), " vertex."]);
                        log(false, ["And no adjacent Vertex around ", JSON.stringify(vertexCoord), "."]);
                        break;
                    } else {
                        const foundVertex = this.vertices.get(JSON.stringify(checkVertex));
                        const v1 = {
                            x: value.first[0] === JSON.parse(vertexCoord)[0] ? true : false,
                            y: value.first[1] === JSON.parse(vertexCoord)[1] ? true : false,
                        }
                        const v2 = {
                            x: foundVertex.first[0] === checkVertex[0] ? true : false,
                            y: foundVertex.first[1] === checkVertex[1] ? true : false,
                        }
                        if (    (v1.x === true || v1.y === true) &&     // v1 is either horizontal or vertical
                                (v2.x === true || v2.y === true) &&     // v2 is either horizontal or vertical
                                (v1.x !== v2.x) && (v1.y !== v2.y) ) {  // v1 and v2 are not both horizontal or vertical
                                    const dir = {
                                        x: v1.x ? (vertexCoord[0] < value.first[0] ? -1 : 1) : 0,
                                        y: v1.y ? (vertexCoord[1] < value.first[1] ? -1 : 1) : 0
                                    }
                                    const newCoord = [JSON.parse(vertexCoord)[0] + dir.x, JSON.parse(vertexCoord)[1] + dir.y];
                                    const checkVertexOther = this.vertices.get(JSON.stringify(foundVertex.first));
                                    const vertexCoordOther = this.vertices.get(JSON.stringify(value.first));
                                    // Going to delete checkVertex and vertexCoord, and replace them both with newCoord
                                    // Replace the reference in checkVertexOther from checkVertex to newCoord
                                    log(false, ["Updating vertex: ", foundVertex.first]);
                                    if ( JSON.stringify(checkVertexOther.first) === JSON.stringify(checkVertex) ) 
                                        this.vertices.set(JSON.stringify(foundVertex.first), {first: newCoord, second: checkVertexOther.second});
                                    else this.vertices.set(JSON.stringify(foundVertex.first), {first: checkVertexOther.first, second: newCoord});
                                    // Replace the reference in vertexCoordOther from vertexCoord to newCoord
                                    log(false, ["Updating vertex: ", vertexCoordOther.first]);
                                    if ( JSON.stringify(vertexCoordOther.first) === JSON.stringify(vertexCoord) )
                                        this.vertices.set(JSON.stringify(value.first), {first: newCoord, second: vertexCoordOther.second});
                                    else this.vertices.set(JSON.stringify(value.first), {first: vertexCoordOther.first, second: newCoord});
                                    // Create the newCoord vertex
                                    log(false, ["Creating vertex: ", newCoord]);
                                    this.vertices.set(JSON.stringify(newCoord), {first: foundVertex.first, second: value.first});
                                    // Delete vertexCoord and checkVertex
                                    log(false, ["Deleting vertex: ", JSON.parse(vertexCoord)]);
                                    this.vertices.delete(vertexCoord);
                                    log(false, ["Deleting vertex: ", checkVertex]);
                                    this.vertices.delete(JSON.stringify(checkVertex));
                                }
                        continue; 
                    }
            }

        }

        if ( this.#isDebugging ) {
            this.pixelsDebugContainer.removeChildren();
            for (const coord of this.perimeterPixels) {
                const coords = JSON.parse(coord);
                const pixelDot = new PIXI.LegacyGraphics();
                pixelDot.beginFill(0xFF0000);
                pixelDot.drawCircle(coords[0],coords[1], 2);
                pixelDot.endFill();
                this.pixelsDebugContainer.addChild(pixelDot);
            }

            for (const [values, key] of this.vertices) {
                const value = JSON.parse(values);
                const vertexDot = new PIXI.LegacyGraphics();
                vertexDot.beginFill(0xFFE97F);
                vertexDot.drawCircle(value[0],value[1], 15);
                vertexDot.endFill();
                this.pixelsDebugContainer.addChild(vertexDot);
            }
        }

        log(false, [this.vertices])

        return true;
    }

    /** A loop that recursively calls _getVertices() until all logic has been completed. */
    getVertices() {
        let loopGetVertices = false;
        do {
            loopGetVertices = this._getVertices();
        } while (loopGetVertices === false);
    }

    /** Foundry core's drawing polygon method requires an ordered series of point coordinates in array form, ie: [0,0]
     *  It also normalizes the data points relative to the top left corner of a bounding box.
     *  Need an array of normalized vertex points, ordered such that the points
     *  define a perimeter and end at the same coordinate it started.
     * @return {array}      Ordered array of polygon vertices
     */
    prepareVertexData() {

        const orderedArray = [];
        // To make sure the array is ordered, going to need to manually initialize the array with the first two coordinates
        orderedArray.push(JSON.parse(this.boundingBox.startPt));
        const secondPt = this.vertices.get(this.boundingBox.startPt);
        orderedArray.push(secondPt.first);

        // The function that will iterate over all the vertices to find the next one.
        function _orderVertices() {
            const vertexData = this.vertices.get(JSON.stringify(orderedArray[orderedArray.length - 1]));
            return JSON.stringify(vertexData.first) === JSON.stringify(orderedArray[orderedArray.length - 2]) ? vertexData.second : vertexData.first;
        }

        const orderVertices = _orderVertices.bind(this);

        do {
            orderedArray.push(orderVertices());
        } while (JSON.stringify(orderedArray[0]) !== JSON.stringify(orderedArray[orderedArray.length - 1]));

        // Now to normalize the array coordinates relative to the bounding box top left corner.

        const normalizedArray = orderedArray.map(coord => {
            return [coord[0] - this.boundingBox.x0, coord[1] - this.boundingBox.y0];
        })

        return normalizedArray
    }

    async _generateDrawingPolygon() {

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
        const document = new DrawingDocument(getNewDrawingData({x: this.boundingBox.x0 + d.paddingX, y: this.boundingBox.y0 + d.paddingY}), {parent: canvas.scene});
        let drawingDoc = new Drawing(document);
        drawingDoc.data.points = this.prepareVertexData();

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

    getColor(box) {
        // Define a color using RGB and A, but A is always 255 (solid/opaque).
        // The R value is interpolated between x=0/R=0 : x=sceneWidth/R=255
        // The G value is interpolated between y=0/G=0 : y=sceneHeight/G=255

        // The scene would be colored sufficiently with simply R & G values, BUT!
        // if the scene is larger than 255 x 255, then the interpolation will result in
        // blocks of the same color.  A kind of a pixelation.

        // So, use the B value to break those blocks up further.  
        // The B value is interpolated from the center of the scene to the pixel, where max B = 255
        // is the intersection of the resulting slope with X=0 or X=sceneWidth or Y=0 or Y=sceneHeight

        function lineLength(P1, P2) {
            return Math.sqrt(Math.pow((P1.x - P2.x),2) + Math.pow((P1.y - P2.y), 2));
        }

        const boxCenterPoint = {
            x: box.x0 + (box.width / 2),
            y: box.y0 + (box.height / 2)
        }

        const d = canvas.dimensions;
        const R = Math.round((boxCenterPoint.x / d.sceneWidth) * 255);
        const G = Math.round((boxCenterPoint.y / d.sceneHeight) * 255);

        const slope = ((d.sceneWidth/2) - boxCenterPoint.x) / ((d.sceneHeight) - boxCenterPoint.y);
        let b = boxCenterPoint.y - (slope * boxCenterPoint.x);
        let boundaryCoord = {x: undefined, y: undefined};
        if ( slope < 0 && boxCenterPoint.x < (d.sceneWidth/2) ) {
            // Top left quadrant.  If b is not inside sceneRect, then set y = 0
            boundaryCoord = {
                x: b < 0 ? -b / slope : 0,
                y: b < 0 ? 0 : b
            }
        }
        if ( slope < 0 && boxCenterPoint.x > (d.sceneWidth/2) ) {
            // Bottom right quadrant.  Set x = sceneWidth and if not inside sceneRect, then set y = sceneHeight
            const intersectY = (slope * d.sceneWidth) + b;
            boundaryCoord = {
                x: intersectY > d.sceneHeight ? (d.sceneHeight - b / slope) : d.sceneWidth,
                y: intersectY > d.sceneHeight ? d.sceneHeight : intersectY
            }
        }
        if ( slope > 0 && boxCenterPoint.x < (d.sceneWidth/2) ) {
            // Bottom left quadrant.  If b is not inside sceneRect, then set y = sceneHeight
            boundaryCoord = {
                x: b > d.sceneHeight ? (d.sceneHeight - b) / slope : 0,
                y: b > d.sceneHeight ? d.sceneHeight : b
            }
        }
        if ( slope > 0 && boxCenterPoint.x > (d.sceneWidth/2) ) {
            // Top right quadrant.  Set x = sceneWidth and if b is not inside sceneRect, then set y = 0
            const intersectY = (slope * d.sceneWidth) + b;
            boundaryCoord = {
                x: intersectY < 0 ? -b / slope : d.sceneWidth,
                y: intersectY < 0 ? 0 : intersectY
            }
        }
        if ( slope === 0 ) {
            // Horizontal line, distance is same to either side.
            boundaryCoord = {
                x: 0,
                y: b
            };
        }
        if ( !isFinite(slope) ) {
            // Vertical line, distance is same to either side.
            boundaryCoord = {
                x: boxCenterPoint.x,
                y: 0
            }
        }
        if ( boundaryCoord.x === undefined || boundaryCoord.y === undefined) {
            ui.notifications.error("No boundary intersection in getColor() function.")
            return null;
        }

        const B = Math.round((  lineLength({x: boxCenterPoint.x, y: boxCenterPoint.y}, {x: (d.sceneWidth/2), y: (d.sceneHeight/2)}) /
                                lineLength({x: boundaryCoord.x, y: boundaryCoord.y}, {x: (d.sceneWidth/2), y: (d.sceneHeight/2)})) *
                                255);
                                
        // Have to convert RGB to HEX.  Found at https://stackoverflow.com/questions/5623838/rgb-to-hex-and-hex-to-rgb
        const rbgToHex = (R, G, B) => '#' + [R, G, B].map(x => {
            const hex = x.toString(16);
            return hex.length === 1 ? '0' + hex : hex;
        }).join('');
        return rbgToHex(Math.round(R), Math.round(G), Math.round(B));
    }
}