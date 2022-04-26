import { ModuleName } from "../ssm-launch.js";
import { log } from "./functions.js";

export class Texture2Polygon {
    constructor(name, walls) {
        this.subSceneName = name;
        this.instanceWalls = walls;
        this.tempContainer = new PIXI.Container();
        this.dims = canvas.dimensions;
        this.pixels = undefined;
        this.cleanPixelRange = 5;
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

        canvas.stage.addChild(this.tempContainer);
    }

    get #isDebugging() {
        return game.modules.get('_dev-mode')?.api?.getPackageDebugValue(ModuleName);
    }

    /**
     * One of a few non-private methods.  The others are private because they have to be
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
        confirm = await this.#extractPerimeterPixels();
        if ( !confirm ) return false;
        confirm = await this.#extractVerticesFromWalls();
        if ( !confirm ) return false;
        confirm = await this.#removeDanglingWalls();
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
     * A confirmation dialog mostly used when debugging is turned on.
     * @param {string} title
     * @param {string} content
     * @returns {promise}
     */
    async confirmDialog(title, content) {
        const confirm  = await Dialog.confirm({
            title: title,
            content: content,
            yes: () => {return true},
            no: () => {return false}
        })
    }

    /**
     * A commonly used function to display dots on the canvas, mostly used when debugging is turned on.
     * @param {array} coord         // pixel coordinate in format [x,y]
     * @param {string} color        // RGBA color in hexadecimal, ie: "0x000000"
     * @param {number} size         // The size in pixels of the circle that will be seen on the canvas as a dot.
     */
    populatePixiDots(coord, color, size) {
        const dot = new PIXI.LegacyGraphics();
        dot.beginFill(color);
        dot.drawCircle(coord[0],coord[1], size);
        dot.endFill();
        this.tempContainer.addChild(dot)
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
        this.tempContainer.addChild(texSprite);
        // Extract pixel data for the explored texture.
        this.pixels = canvas.app.renderer.extract.pixels(this.tempContainer);
        // Cleanup
        this.tempContainer.removeChild(texSprite);
        texSprite.destroy(true);

        // If devMode module is active and debugging is enabled, show the texture generated from the pixel data on the screen.
        // Once OK has been clicked in a confirmation dialog, the texture will be removed and code execution will proceed.
        if ( this.#isDebugging ) {
            const options = {
                width: this.dims.sceneWidth,
                height: this.dims.sceneHeight
            }
            const br = new PIXI.resources.BufferResource(this.pixels, options);
            const bt = new PIXI.BaseTexture(br);
            const tex = new PIXI.Texture(bt);
            const tempSprite = new PIXI.Sprite(tex);

            canvas.stage.addChild(tempSprite);
            tempSprite.position = {x: this.dims.paddingX, y: this.dims.paddingY};

            const title = "Review Texture from pixel data.";
            const content = "<p>Click YES to continue if texture is correct.</p><p>Click NO to abort execution if texture is incorrect.</p>";
            await this.confirmDialog(title, content);

            canvas.stage.removeChild(tempSprite);
            tempSprite.destroy(true);

            if ( !confirm ) return false;
        }
        
        // Some RGBA values are sometimes not 0 or 255.  
        this.#cleanPixels(this.cleanPixelRange);

        await this.#verifyPixels();

        return true;
    }

    /**
     * Called by this.#getPixelData, this method cleans up occasional variances in the
     * RGBA values.  They should be 0 or 255, but occasionally can be between 0 and 5, or
     * 250 and 255.
     * @private
     */
    #cleanPixels(range) {
        for (let i=0; i < this.pixels.length; i+=4) {
            let R = this.pixels[i];
            let G = this.pixels[i+1];
            let B = this.pixels[i+2];
            let A = this.pixels[i+3];

            if ( R < range ) this.pixels[i] = 0
            else if ( R > (255 - range) ) this.pixels[i] = 255;

            if ( G < range ) this.pixels[i+1] = 0
            else if ( G > (255 - range) ) this.pixels[i+1] = 255;

            if ( B < range ) this.pixels[i+2] = 0
            else if ( B > (255 - range) ) this.pixels[i+2] = 255;

            if ( A < range ) this.pixels[i+3] = 0
            else if ( A > (255 - range) ) this.pixels[i+3] = 255;
        }
    }

    /**
     * Called by this.#getPixelData.
     * Method will display how many pixels are outside of this.cleanPixelRange.
     * It will offer to continue with a greater range (increments of +5) or
     * it will offer to abort.
     * @private
     * @returns {boolean}               // True on success.
     */
    async #verifyPixels() {
        function _verify() {
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

            if ( !pixelError ) return true;
            return pixelError;
        }
        const verify = _verify.bind(this);

        const check = verify();
        if ( check ) return true;

        const confirm = await Dialog.confirm({
            title: "Review pixel errors.",
            content: `  <p>Pixel Errors: ${pixelError}.</p>
                        <p>Current pixel RGBA threshold from 0 or 255: ${this.cleanPixelRange}.</p>
                        <p>Click YES to increase range by 5 and try again.</p>
                        <p>Otherwise, click NO to abort.</p>`,
            yes: async () => {
                this.cleanPixelRange += 5;
                await this.#verifyPixels();
            },
            no: () => {return false}
        })

        if ( !confirm ) return false

        return true;
    }

    /**
     * Because the pixel data only contains black with zero alpha and white with 255 alpha,
     * it is possible to compress the data by generating arrays that represent when the white
     * pixels start and end for every row and column.  This also makes it very convenient to
     * extract perimeter pixels from the data.
     * Data is saved to this.compressedPixelData
     * this.pixels is then set to undefined, to free up memory.
     * @private
     */
    #compressPixelDataTemp() {
        let isBlackX = true;  // use for column, ie: y = 0 to y = this.dims.sceneHeight
        let isBlackY = true;  // use for row, ie: x = 0, x = this.dims.sceneWidth

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
        let isBlack = true;

        function _analyzePixels(isBlack, x, y, direction) {
            // this.pixels is one massive array.  Each pixel has 4 values in this array, ie: [R1, G1, B1, A1, R2, G2, B2, A2, ...Rn, Gn, Bn, An]
            // The index value for any given pixel at X,Y coordinate:
            const pixelIndex = (( (y - this.dims.paddingY) * this.dims.sceneWidth + (x - this.dims.paddingX) ) * 4);
            // key & value has to do with this.compressedPixelData Maps.
            const key = direction === "vertical" ? x : y;
            const value = direction === "vertical" ? y : x;
            // The [R,G,B,A] value as a string, for any given pixel
            const pixelData = JSON.stringify([this.pixels[pixelIndex], this.pixels[pixelIndex+1], this.pixels[pixelIndex+2], this.pixels[pixelIndex+3]]);
            // RGBA values for a white pixel, or a black pixel.
            const pixelIsWhite = pixelData === "[255,255,255,255]";
            const pixelIsBlack = pixelData === "[0,0,0,0]";
            // If previous pixel was black and the current pixel is black, there's no change and nothing to do.
            if ( isBlack && pixelIsBlack ) return isBlack;
            // If previous pixel was white and the current pixel is white, there's no change and nothing to do.
            if ( !isBlack && pixelIsWhite ) return isBlack;
            // If the previous pixel was black and the current pixel is white, we need to add coordinate to a new array
            if ( isBlack && pixelIsWhite ) {
                // If the row or column already exists...
                if ( this.compressedPixelData[direction].has(key) ) {
                    // ... then we want to add a new array to the array of arrays.
                    const toUpdate = this.compressedPixelData[direction].get(key);
                    toUpdate.push([value])
                    this.compressedPixelData[direction].set(key, toUpdate);
                } else this.compressedPixelData[direction].set(key, [[value]]);  // The row or column doesn't exist.  Create one and add a new array.
            }

            // If the previous pixel was white and the current pixel is black, we need to add coordinate to the last array.
            if ( !isBlack && pixelIsBlack) {
                // The row or colum has to exist already.  
                const toUpdate = this.compressedPixelData[direction].get(key);
                // Add the coordinate to the last array in the array of arrays.
                toUpdate[toUpdate.length-1].push(value);
                this.compressedPixelData[direction].set(key, toUpdate);
            }

            // If code execution has reached this point, we have added a coordinate and now need to flip the isBlack boolean.
            return !isBlack;
        }

        const analyzePixels = _analyzePixels.bind(this);

        // Will iterate through every column in the scene
        for (let x = this.dims.paddingX; x < (this.dims.sceneWidth + this.dims.paddingX); x++) {
            // Iterate through every pixel in the scene for this column
            for (let y = this.dims.paddingY; y < (this.dims.sceneHeight + this.dims.paddingY); y++) {
                // Check if the previous pixel is a different color than this one.
                isBlack = analyzePixels(isBlack, x, y, "vertical");
            }

            // Iterated over the entire column of pixels.  If the isBlack boolean is still white,
            // then that means the scene border is the final coordinate.
            if ( !isBlack ) {
                const toUpdate = this.compressedPixelData.vertical.get(x);
                toUpdate[toUpdate.length-1].push(this.dims.sceneHeight + this.dims.paddingY);
                this.compressedPixelData.vertical.set(x, toUpdate);
                isBlack = !isBlack;
            }
        }

        // Reset and do again.  Iterate through every row in the scene
        isBlack = true;
        for (let y = this.dims.paddingY; y < (this.dims.sceneHeight + this.dims.paddingY); y++) {
            // Iterate through every pixel in the scene for this row
            for (let x = this.dims.paddingX; x < (this.dims.sceneWidth + this.dims.paddingX); x++) {
                // Check if the previous pixel is a different color than this one.
                isBlack = analyzePixels(isBlack, x, y, "horizontal");
            }

            // Iterated over the entire row of pixels.  if the isBlack boolean is still white,
            // then that means the scene border is the final coordinate.
            if ( !isBlack ) {
                const toUpdate = this.compressedPixelData.horizontal.get(y);
                toUpdate[toUpdate.length-1].push(this.dims.sceneWidth + this.dims.paddingX);
                this.compressedPixelData.horizontal.set(y, toUpdate);
                isBlack = !isBlack;
            }
        }

        // With this.compressedPixelData, we no longer need the data in this.pixels.
        // Clean it up to free memory.
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
            for (let coord of this.vertexCoords) {
                const coords = JSON.parse(coord);
                this.populatePixiDots(coords, "0xFFE97F", 15);            
            }

            const title = "Review Vertices extracted from wall data.";
            const content = "<p>Click YES to continue if vertices are correct.</p><p>Otherwise, click NO to abort execution.</p>";
            const confirm = await this.confirmDialog(title, content);

            this.tempContainer.removeChildren();

            if ( !confirm ) return false
        }
        return true;
    }

    /**
     * Method checks this.compressedPixelData to see if any given pixel is 'white', ie: explored in the scene.
     * If the coordinate is in between the values of a sub-array, then it returns true.
     * @param {number} x        // The x value of the pixel coordinate
     * @param {number} y        // The y value of the pixel coordinate
     * @returns {boolean}       // True if explored.
     */
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

    /**
     * The set of walls included in the constructor of this class can include walls that have
     * one point on the outside perimeter of the explored area, but the other point is in unexplored
     * area.  These walls need to be removed from the set, as well as the vertex out in the unexplored area.
     * @returns {boolean}           // Returns true if successful.
     */
    async #removeDanglingWalls() {
        for (const [id, wall] of this.instanceWalls) {
            for (let i=0; i < wall.data.c.length; i+= 2) {
                const row = wall.data.c[i+1];
                const column = wall.data.c[i]; 
                const checkisExplored = this.#pixelIsExplored(column, row);
                if ( !checkisExplored ) {
                    this.instanceWalls.delete(id);
                    this.vertexCoords.delete(JSON.stringify([column, row]));
                    break;
                }
            }
        }

        if ( this.#isDebugging ) {
            for (let coord of this.vertexCoords) {
                const coords = JSON.parse(coord);
                this.populatePixiDots(coords, "0xFFE97F", 15);            
            }

            const title = "Review Vertices after dangling walls removed.";
            const content = "<p>Click YES to continue if vertices are correct.</p><p>Otherwise, click NO to abort execution.</p>";
            const confirm = await this.confirmDialog(title, content);

            this.tempContainer.removeChildren();

            if ( !confirm ) return false
        }
        
        return true;
    }

    /**
     * Populate this.perimeterPixels with every pixel on the perimeter of the explored area
     * @returns {boolean}           // True if successful
     */
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
            for (let coord of this.perimeterPixels) {
                const coords = JSON.parse(coord);
                this.populatePixiDots(coords, "0xFF0000", 2);         
            }

            const title = "Review Perimeter Pixels.";
            const content = "<p>Click YES to continue if perimeter is correct.</p><p>Otherwise, click NO to abort execution.</p>";
            const confirm = await this.confirmDialog(title, content);

            this.tempContainer.removeChildren();

            if ( !confirm ) return false
        }
        
        return true;
    }

    /**
     * this.vertexCoords will contain several vertices resulting from walls that are inside the explored area.
     * The goal of this class and its methods is to generate the minimal set of vertices to generate a polygon
     * representing the explored area.  The vertices inside the explored area are not necessary.
     * However, the interior walls will be needed when constructing the sub-scene, so it is required to keep them
     * in this.instanceWalls.
     * To avoid duplicating the efforts of finding interior walls, all interior walls will be added to this.omitWalls
     * @returns {boolean}           // True if successful
     */
    async #removeInteriorWallsVertices() {
        /**
         * The logic to define how this algorithm knows a vertex belongs to an interior wall will rely on the
         * individual pixel points stored in this.perimeterPixels.  If each coordinate of a vertex has
         * a corresponding perimeterPixel, then it is an outside vertex and has to remain.
         */
        for (const vertex of this.vertexCoords) {
            const coord = JSON.parse(vertex);
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
                        const offsetPixel = [coord[0] + offsetX, coord[1] + offsetY];
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
            for (let coord of this.vertexCoords) {
                const coords = JSON.parse(coord);
                this.populatePixiDots(coords, "0xFFE97F", 15);          
            }

            const title = "Review Vertices after interior vertices removed.";
            const content = "<p>Click YES to continue if vertices are correct.</p><p>Otherwise, click NO to abort execution.</p>"
            const confirm = await this.confirmDialog(title, content);

            this.tempContainer.removeChildren();

            if ( !confirm ) return false
        }
        return true;
    }

    /**
     * Mutate this.vertexCoords to begin adding references to other vertices by using the existing
     * wall data to infer those links.
     * This will be useful when ordering the vertices.
     */
    #linkVerticesByWalls() {
        /**
         * The link info for coordinates will be stored as objects in an array with the following
         * object definition:
         *      vertexCoord = {
         *          coord: <string>,
         *          walls: <array of wall documents>,
         *          first: <coord of fist wall>,
         *          second: <coord of second wall>
         *      }
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
                    // If an interior wall has been found, skip it.
                    if ( this.omitWalls.has(wall) ) continue;
                    obj.walls.push(wall)
                }
            }

            newVertexArray.push(obj);
        }

        // Step 2: Link walls
        for (const vertexObj of newVertexArray) {

            // Use the walls we've added to the vertex object to find out what the other
            // vertex references are
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

    /**
     * If there are 3 points in a straight line, the line only needs the points at the extremities to define it.
     * This method deletes excess points for a given line.
     * @returns {boolean}           // Returns true if successful
     */
    async #removeSameSlopeVertices() {

        function slope(a, b) {
            return ( (a[1]-b[1]) / (a[0]-b[0]) )
        }

        // Start with a vertex that has only one reference to another vertex, if possible
        const startingVertex = this.vertexCoords.filter(v => v.first === undefined || v.second === undefined);
        let v0;
        // If there are no vertices with only one vertex reference, then just use the first in this.vertexCoords.
        if ( startingVertex.length ) v0 = this.vertexCoords[0];
        else v0 = startingVertex[0];

        let v1 = this.vertexCoords.filter(v => v.coord === JSON.stringify(v0.first))[0];
        let nextVertex = JSON.stringify(v1.first) === v0.coord ? v1.second : v1.first;
        let v2 = this.vertexCoords.filter(v => v.coord === JSON.stringify(nextVertex))[0];

        // With 3 consecutive vertices defined (v0, v1, v2), check if they all belong on a straight line
        // and if so, fix the references for v0 and v2 such that v1 is eliminated.
        // Then find the next referenced vertex and repeat the process until all vertices have been processed.
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
            for (let obj of this.vertexCoords) {
                const coords = JSON.parse(obj.coord);
                this.populatePixiDots(coords, "0xFFE97F", 15);           
            }

            const title = "Review Vertices after inline vertices removed.";
            const content = "<p>Click YES to continue if vertices are correct.</p><p>Otherwise, click NO to abort execution.</p>";
            const confirm = await this.confirmDialog(title, content);

            this.tempContainer.removeChildren();

            if ( !confirm ) return false
        }
        return true;
    }

    /** 
     * Add vertices that are present on the perimeter of the image.  But there's a GOTCHA here...
     * To explain, assume an image that is 2 pixels by 2 pixels.
     * 
     * The vertices populated from wall data use a coordinate system that snaps to the top left of a given pixel.
     * Assuming walls are placed on the boundaries to encapsulate the image pixels:
     *   The top left [1,1] pixel of the image will have a wall coordinate of [0,0]
     * 
     *   The bottom right [2,2] pixel of the image will have a wall coordinate of [3,3]
     *   If the bottom right wall coordinate was [2,2], and wall coordinates snap to the top left corner of a given pixel,
     *   then the boundary wall on the bottom and right would be missing the 2nd row and 2nd column of image pixels.
     * 
     * This means when we search the compressedPixelData, we have to use wall coordinates because that's how it's been stored
     * up to this point.
     * However, once the compressedPixelData provides the information we need, for cases where x = sceneWidth and y = sceneHeight,
     * we need to add 1 to bump the wall coordinate to the other side of the pixel.
     * 
     * @returns {boolean}               // Returns true if successful
     */
    async #addBoundaryVertices() {

        function _addBoundaryVertex(dir, limits) {
            for (const bounds of limits) {
                if ( this.compressedPixelData[dir].has(bounds) ) {
                    const boundarySegments = this.compressedPixelData[dir].get(bounds); // Array of arrays.
                    let coord1 = [];
                    let coord2 = [];
                    for (const segment of boundarySegments) {
                        // This is where we figure out if x = sceneWidth or y = sceneHeight and add 1.
                        if ( bounds === limits[1] ) {
                            coord1 = dir === "horizontal" ? [segment[0], bounds + 1] : [bounds + 1, segment[0]];
                            coord2 = dir === "horizontal" ? [segment[1], bounds + 1] : [bounds + 1, segment[1]];
                        } else {
                            coord1 = dir === "horizontal" ? [segment[0], bounds] : [bounds, segment[0]];
                            coord2 = dir === "horizontal" ? [segment[1], bounds] : [bounds, segment[1]];
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
        const addBoundaryVertex = _addBoundaryVertex.bind(this);

        addBoundaryVertex("horizontal", [this.dims.paddingY, this.dims.sceneHeight + this.dims.paddingY - 1]);
        addBoundaryVertex("vertical", [this.dims.paddingX, this.dims.sceneWidth + this.dims.paddingX - 1])

        if ( this.#isDebugging ) {
            for (let obj of this.vertexCoords) {
                const coords = JSON.parse(obj.coord);
                this.populatePixiDots(coords, "0xFFE97F", 15);            
            }

            const title = "Review after boundary vertices added.";
            const content = "<p>Click YES to continue if vertices are correct.</p><p>Otherwise, click NO to abort execution.</p>";
            const confirm = await this.confirmDialog(title, content);

            this.tempContainer.removeChildren();

            if ( !confirm ) return false
        }
        return true;
    }

    /**
     * With the vertices added from wall data and the vertices added along the scene boundaries,
     * there may be a few remaining vertices that do not have complete references to other vertices.
     */
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
        
        // Find all vertices that are missing references
        let unlinkedVertices = this.vertexCoords.filter(v => v.first === undefined || v.second === undefined);
        // If there are none, then we're done.
        if ( !unlinkedVertices.length ) return;
        // Otherwise, start trying to determine which need to be linked to which.
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

                        if ( !is25 || !is50 || !is75 ) continue;  // If just one of these checks is negative, we continue looking.

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

                        if ( !is25 || !is50 || !is75 ) continue;  // If just one of these checks is negative, we continue looking.

                        update = true;
                    }

                    if ( update ) link(vert1, vert)
                }
            } else {
                // Only two left.
                link(unlinkedVertices[0], unlinkedVertices[1]);
            }

            // We have linked two vertices together.  Need to remove them from the array.
            unlinkedVertices = this.vertexCoords.filter(v => v.first === undefined || v.second === undefined);

        } while ( unlinkedVertices.length )
    }

    /** Foundry core's drawing polygon method requires an ordered series of point coordinates in array form, ie: [x,y]
     *  It also normalizes the data points relative to the top left corner of a bounding box that contains all the vertices.
     *  Need an array of normalized vertex points, ordered such that the points define a perimeter and end at the same
     *  coordinate it started.
     * @return {promise}      
     */
     async #prepareVertexData() {

        const orderedArray = [];
        const smallestX = this.vertexCoords.reduce((pv, cv) => Math.min(pv, JSON.parse(cv.coord)[0]), this.dims.sceneWidth + this.dims.paddingX + 1);
        const smallestY = this.vertexCoords.reduce((pv, cv) => Math.min(pv, JSON.parse(cv.coord)[1]), this.dims.sceneHeight + this.dims.paddingY + 1);
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
        this.polygonVertexCoordinates = orderedArray.map(coord => {
            return [coord[0] - smallestX, coord[1] - smallestY];
        })

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

            const title = "Review perimeter generated from vertices.";
            const content = "<p>Click YES to continue if the perimeter is correct.</p><p>Otherwise, click NO to abort execution.</p>";
            const confirm = await this.confirmDialog(title, content);

            canvas.stage.removeChild(graphics);
            graphics.destroy(true);

            if ( !confirm ) return false
        }
        return true;
    }

    /**
     * Define a color using RGB.
     * The R value is interpolated between x=0/R=0 : x=sceneWidth/R=255
     * The G value is interpolated between y=0/G=0 : y=sceneHeight/G=255
     * 
     * The scene would be colored sufficiently with simply R & G values, BUT!
     *  if the scene is larger than 255 x 255, then the interpolation will result in
     * blocks of the same color.  A kind of a pixelation.
     * 
     * So, use the B value to break those blocks up further.
     * The B value is interpolated from the center of the scene to the pixel, where max B = 255
     * is the distance from the center to the corners.
     * 
     * @param {object}  box                 // An object defining the bounding box of the area to be colored
     *                  box.x               // x coordinate of the top left corner.
     *                  box.y               // y coordinate of the top left corner.
     *                  box.width           // width of bounding box
     *                  box.height          // height of bounding box
     *                  box.center          // object containing {x,y} coordinates for the center of the bounding box
     * @returns {string}                    // RGB value in hexadecimal, ie: 0x000000
     */
    getColor(box) {

        function lineLength(P1, P2) {
            return Math.sqrt(Math.pow((P1.x - P2.x),2) + Math.pow((P1.y - P2.y), 2));
        }

        const sceneCenter = {
            x: this.dims.sceneWidth / 2,
            y: this.dims.sceneHeight / 2
        }
        const R = Math.round((box.center.x / this.dims.sceneWidth) * 255);
        const G = Math.round((box.center.y / this.dims.sceneHeight) * 255);
        const maxB = lineLength(sceneCenter, {x: 0, y: 0});
        const B = Math.round((lineLength(sceneCenter, box.center) / maxB) * 255);
                                
        // Have to convert RGB to HEX.  Found at https://stackoverflow.com/questions/5623838/rgb-to-hex-and-hex-to-rgb
        const rbgToHex = (R, G, B) => '#' + [R, G, B].map(x => {
            const hex = x.toString(16);
            return hex.length === 1 ? '0' + hex : hex;
        }).join('');
        return rbgToHex(Math.round(R), Math.round(G), Math.round(B));
    }

    /**
     * Creates a drawing on the canvas identifying the area to be captured as a sub-scene.
     * 
     * @returns {string}                // The id of the drawing object generated by Foundry
     */
    async #generateDrawingPolygon() {

        function _getNewDrawingData(origin) {
             // Get saved user defaults
            const defaults = game.settings.get("core", "defaultDrawingConfig") || {};
            const data = foundry.utils.mergeObject(defaults, {
                text: this.subSceneName,
                textColor: '#000000',  // Black
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
