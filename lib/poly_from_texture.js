import { ModuleName } from "../ssm-launch.js";
import { log, confirmDialog, slope } from "./functions.js";

export class Texture2Polygon {
    constructor(parent) {
        this.parent = parent;
        this.subSceneName = parent.inWorkDivTitle;
        this.instanceWalls = parent.instanceWalls;
        this.tempContainer = new PIXI.Container();
        this.mask = undefined;
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
        this.edgesNotFromWall = [];
        this.polygonVertexCoordinates = [];
        this.boundingBox = {};
        this.drawingColor = undefined;
        this.drawingID = undefined;

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
        let confirm = {
            otherSubScenesMask: undefined,
            getPixelData: undefined,
            extractPerimeterPixels: undefined,
            extractVerticesFromWalls: undefined,
            removeNonPerimeterWalls: undefined,
            removeSameSlopeVertices: undefined,
            addBoundaryVertices: undefined,
            linkFinalVertices: undefined,
            prepareVertexData: undefined
        };

        try {
            confirm.otherSubScenesMask = await this.#generateMaskFromOtherSubScenes();
            if ( !confirm.otherSubScenesMask ) throw game.i18n.localize('SSM.T2P_Errors.GMFOSS');
            confirm.getPixelData = await this.#getPixelData();
            if ( !confirm.getPixelData ) throw game.i18n.localize('SSM.T2P_Errors.GPD');
            this.#compressPixelData();
            confirm.extractPerimeterPixels = await this.#extractPerimeterPixels();
            if ( !confirm.extractPerimeterPixels ) throw game.i18n.localize('SSM.T2P_Errors.EPP');
            confirm.extractVerticesFromWalls = await this.#extractVerticesFromWalls();
            if ( !confirm.extractVerticesFromWalls ) throw game.i18n.localize('SSM.T2P_Errors.EVFW');
            confirm.removeNonPerimeterWalls = await this.#removeNonPerimeterWalls();
            if ( !confirm.removeNonPerimeterWalls ) throw game.i18n.localize('SSM.T2P_Errors.RNPW');
            this.#linkVerticesByWalls();
            confirm.removeSameSlopeVertices = await this.#removeSameSlopeVertices();
            if ( !confirm.removeSameSlopeVertices ) throw game.i18n.localize('SSM.T2P_Errors.RSSV');
            confirm.addBoundaryVertices = await this.#addBoundaryVertices();
            if ( !confirm.addBoundaryVertices ) throw game.i18n.localize('SSM.T2P_Errors.ABV');
            confirm.linkFinalVertices = this.#linkFinalVertices();
            if ( !confirm.linkFinalVertices ) throw game.i18n.localize('SSM.T2P_Errors.LFV');
            this.boundingBox = this.#generateBoundingBox();
            confirm.prepareVertexData = await this.#prepareVertexData();
            if ( !confirm.prepareVertexData ) throw game.i18n.localize('SSM.T2P_Errors.PVD');
            this.drawingID = await this.#generateDrawingPolygon();
            this.#cleanup();
            return true;
        } catch (error) {
            console.error(error);
            console.error(confirm);
            ui.notifications.error(error + "See console.")
            return false;
        }
    }

    /**
     * A frequently used function to display dots on the canvas when debugging is turned on.
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
     * Crop the explored mask to remove areas that have already been explored by other divisions.
     * @returns {boolean}                   // True on success
     */
    async #generateMaskFromOtherSubScenes() {
        if ( this.parent.divisions.length === 0 ) return true;
        const msk = new PIXI.LegacyGraphics();
        msk.beginFill(0x000000);
        for (const div of this.parent.divisions) {
            const bounds = div.boundingBox;
            const polyCoords = div.polygonVertexCoordinates;
            let points = [];
            for (const pt of polyCoords) {
                const scenePt = [pt[0] + bounds.sceneX, pt[1] + bounds.sceneY];
                points = [...points, ...scenePt];
            }
            const poly = new PIXI.Polygon(points);
            msk.drawPolygon(poly);
        }
        msk.endFill();

        const container = new PIXI.Container();
        const whiteSprite = new PIXI.Sprite(PIXI.Texture.WHITE);
        // PIXI.Texture.WHITE is 16x16.  Stretch it to the size of the scene.
        whiteSprite.width = this.dims.sceneWidth;
        whiteSprite.height = this.dims.sceneHeight;
        container.addChild(whiteSprite);
        container.addChild(msk)
        this.mask = canvas.app.renderer.extract.pixels(container);
        container.destroy(true);

        if ( this.#isDebugging ) {
            const options = {
                width: this.dims.sceneWidth,
                height: this.dims.sceneHeight
            }
            const br = new PIXI.resources.BufferResource(this.mask, options);
            const bt = new PIXI.BaseTexture(br);
            const tex = new PIXI.Texture(bt);
            const tempSprite = new PIXI.Sprite(tex);

            canvas.stage.addChild(tempSprite);
            tempSprite.position = {x: this.dims.paddingX, y: this.dims.paddingY};

            const title = game.i18n.localize('SSM.T2P_Errors.gmfoss.title');
            const content = game.i18n.localize('SSM.T2P_Errors.gmfoss.content');
            const confirm = await confirmDialog(title, content);

            canvas.stage.removeChild(tempSprite);
            tempSprite.destroy(true);

            if ( !confirm ) return false;
        }

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
        texSprite.x = this.dims.paddingX;
        texSprite.y = this.dims.paddingY;
        // A temporary container to use.
        this.tempContainer.addChild(texSprite);
        // Extract pixel data for the explored texture.
        this.pixels = canvas.app.renderer.extract.pixels(this.tempContainer);
        // Cleanup
        this.tempContainer.removeChild(texSprite);
        this.tempContainer.removeChild(this.mask);
        texSprite.destroy(false);   // false, dont destroy canvas.sight.saved.texture!!

        if ( this.mask !== undefined ) {
            for (let i=0; i < this.mask.length; i+=4) {
                const isBlackMask = "[0,0,0,255]";
                const maskPixel = JSON.stringify([this.mask[i], this.mask[i+1], this.mask[i+2], this.mask[i+3]])
                if ( maskPixel === isBlackMask) {
                    this.pixels[i] = 0;
                    this.pixels[i+1] = 0;
                    this.pixels[i+2] = 0;
                    this.pixels[i+3] = 0;
                }
            }

            this.mask = undefined;  // Free up memory!
        }


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

            const title = game.i18n.localize('SSM.T2P_Errors.gpd.title');
            const content = game.i18n.localize('SSM.T2P_Errors.gpd.content');
            const confirm = await confirmDialog(title, content);

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

        const confirm = await Dialog.confirm({
            title: game.i18n.localize('SSM.T2P_Errors.vp.title'),
            content:    game.i18n.localize('SSM.T2P_Errors.vp.content1') + 
                        `${pixelError}` +
                        game.i18n.localize('SSM.T2P_Errors.vp.content2') + 
                        `${this.cleanPixelRange}` + 
                        game.i18n.localize('SSM.T2P_Errors.vp.content3'),
            yes: async () => {
                this.cleanPixelRange += 5;
                this.#cleanPixels(this.cleanPixelRange)
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
     * extract perimeter pixels from the data later.
     * Data is saved to this.compressedPixelData
     * this.pixels is then set to undefined, to free up memory.
     * @private
     */
    #compressPixelData() {

        // A 3000 x 3000 image will have over 40,000,000 entries in this.pixels.
        // It is worth taking the time to eliminate as many pixels as possible before
        // applying logic to every pixel.
        let coord = {
            x: this.dims.paddingX -1,
            y: this.dims.paddingY
        }
        let firstWhite = undefined;
        let lastWhite = undefined;

        // Going to iterate from the start of this.pixels and keep going until we find the first white pixel.
        // When we find it, record the pixel coordinate and the array index.  Then break out of the loop.
        for (let i=0; i < this.pixels.length; i+=4) {
            coord.x += 1;
            if ( coord.x === this.dims.paddingX + this.dims.sceneWidth ) {
                coord.y += 1;
                coord.x = this.dims.paddingX;
            }

            if ( this.pixels[i] === 255 && this.pixels[i+1] === 255 && this.pixels[i+2] === 255 && this.pixels[i+4] === 255) {
                firstWhite = {
                    index: i,
                    coord: coord
                };
                break;
            }
        }

        coord = {
            x: this.dims.paddingX + this.dims.sceneWidth + 1,
            y: this.dims.paddingY + this.dims.sceneHeight
        }

        // Going to iterate from the end of this.pixels and keep going until we find the first white pixel (which
        // would be the last white pixel in this.pixel since we are iterating backwards).
        // When we find it, record the pixel coordinate and the array index.  Then break out of the loop.
        for (let i=this.pixels.length - 1; i >= 0; i-=4) {
            coord.x -= 1;
            if ( coord.x === this.dims.paddingX ) {
                coord.y -= 1;
                coord.x = this.dims.paddingX + this.dims.sceneWidth
            }

            if ( this.pixels[i] === 255 && this.pixels[i-1] === 255 && this.pixels[i-2] === 255 && this.pixels[i-3] === 255) {
                lastWhite = {
                    index: i - 3,
                    coord: coord
                };
                break;
            }            
        }

        // Set our coord variable to the first white pixel found.
        coord = firstWhite.coord;
        // Substract 1 from coord.x because the first thing the following loop will do is add 1.
        coord.x -= 1;

        // Iterate from the index of the first white pixel, to the index of the last white pixel.
        // Apply logic to each pixel.
        for (let i=firstWhite.index; i <= lastWhite.index; i+=4) {
            const pixelData = JSON.stringify([this.pixels[i], this.pixels[i+1], this.pixels[i+2], this.pixels[i+3]]);
            const pixelIsWhite = pixelData === "[255,255,255,255]";
            const pixelIsBlack = pixelData === "[0,0,0,0]";

            // Keep track of the x & y pixel coordinate
            coord.x += 1
            if ( coord.x === this.dims.paddingX + this.dims.sceneWidth ) {
                coord.y += 1;
                coord.x = this.dims.paddingX;
            }

            // Checks to do when the pixel is white
            if ( pixelIsWhite ) {

                // Check to see if an entry even exists in the map for this column
                if ( this.compressedPixelData.vertical.has(coord.x) ) {
                    // Check to see if the last array in this.compressedPixelData.vertical has a length of 2
                    // If it does, then the pixel above was black.  Create a new array.
                    const column = this.compressedPixelData.vertical.get(coord.x);
                    const lastArray = column[column.length - 1];
                    if ( lastArray.length === 2 ) {
                        column.push([coord.y]);
                        this.compressedPixelData.vertical.set(coord.x, column);
                    }
                    // If the length was 1, then the pixel above was white, so do nothing.
                }
                // If it doesn't exist, the previous pixel was black.  Create a new array. 
                else this.compressedPixelData.vertical.set(coord.x, [[coord.y]]);

                // Check to see if an entry even exists in the map for this row
                if ( this.compressedPixelData.horizontal.has(coord.y) ) {
                    // Check to see if the last array in this.compressedPixelData.horizontal has a length of 2
                    // If it does, then the pixel to the left was black.  Create a new array.
                    const row = this.compressedPixelData.horizontal.get(coord.y);
                    const lastArray = row[row.length - 1];
                    if ( lastArray.length === 2 ) {
                        row.push([coord.x]);
                        this.compressedPixelData.horizontal.set(coord.y, row);
                    }
                    // If the length was 1, then the pixel to the left was white, so do nothing.
                }
                // If it doesn't exist, the pixel to the left was black.  Create a new array.
                else this.compressedPixelData.horizontal.set(coord.y, [[coord.x]]);
            }

            // Checks to do when the pixel is black
            if ( pixelIsBlack ) {

                // Check to see if an entry even exists in the map for this column
                // If it doesn't, then the pixel above was black and there's nothing to do.
                if ( this.compressedPixelData.vertical.has(coord.x) ) {
                    // Check to see if the last array in this.compressedPixelData.vertical has a length of 2
                    // If it does, then there's nothing to do.  If it doesn't, the pixel above was white, 
                    // and add a new point to the last array.
                    const column = this.compressedPixelData.vertical.get(coord.x);
                    const lastArray = column[column.length - 1];
                    if ( lastArray.length === 1 ) {
                        column[column.length - 1].push(coord.y);
                        this.compressedPixelData.vertical.set(coord.x, column);
                    }
                }

                // Check to see if an entry even exists in the map for this row
                // If it doesn't, then the pixel to the left was black and there's nothing to do.
                if ( this.compressedPixelData.horizontal.has(coord.y) ) {
                    // Check to see if the last array in this.compressedPixelData.horizontal has a length of 2
                    // If it does, then there's nothing to do.  If it doesn't, then the pixel to the left was white,
                    // and add a new point to the last array.
                    const row = this.compressedPixelData.horizontal.get(coord.y);
                    const lastArray = row[row.length - 1];
                    if ( lastArray.length === 1 ) {
                        row[row.length - 1].push(coord.x);
                        this.compressedPixelData.horizontal.set(coord.y, row);
                    }
                }
            }

            // Check if last i
            if ( i === (lastWhite.index)) {
                if ( this.compressedPixelData.horizontal.has(coord.y) ) {
                    // End of the row.  If the last array in this.compressedPixelData.horizontal has a length of 1,
                    // then we need to close it.
                    const row = this.compressedPixelData.horizontal.get(coord.y);
                    const lastArray = row[row.length - 1];
                    if ( lastArray.length === 1 ) {
                        row[row.length - 1].push(coord.x);
                        this.compressedPixelData.horizontal.set(coord.y, row);
                    } 
                }

                if ( this.compressedPixelData.vertical.has(coord.x) ) {
                    // End of the column.  If the last array in this.compressedPixelData.vertical has a length of 1,
                    // then we need to close it.
                    const column = this.compressedPixelData.vertical.get(coord.x);
                    const lastArray = column[column.length - 1];
                    if ( lastArray.length === 1 ) {
                        column[column.length - 1].push(coord.y);
                        this.compressedPixelData.vertical.set(coord.x, column);
                    }
                }

                break;
            }

            // Checks if x = sceneWidth - 1
            if ( coord.x === this.dims.paddingX + this.dims.sceneWidth - 1 ) {
                // Check to see if an entry even exists in the map for this row.  If not, nothing to do.
                if ( this.compressedPixelData.horizontal.has(coord.y) ) {
                    // End of the row.  If the last array in this.compressedPixelData.horizontal has a length of 1,
                    // then we need to close it.
                    const row = this.compressedPixelData.horizontal.get(coord.y);
                    const lastArray = row[row.length - 1];
                    if ( lastArray.length === 1 ) {
                        row[row.length - 1].push(coord.x);
                        this.compressedPixelData.horizontal.set(coord.y, row);
                    } 
                }
            }

            // Checks if the last y in the range.
            if ( coord.y === lastWhite.coord.y - 1 ) {
                // Check to see if an entry even exists in the map for this column.  If not, nothing to do.
                if ( this.compressedPixelData.vertical.has(coord.x) ) {
                    // End of the column.  If the last array in this.compressedPixelData.vertical has a length of 1,
                    // then we need to close it.
                    const column = this.compressedPixelData.vertical.get(coord.x);
                    const lastArray = column[column.length - 1];
                    if ( lastArray.length === 1 ) {
                        column[column.length - 1].push(coord.y);
                        this.compressedPixelData.vertical.set(coord.x, column);
                    }
                }
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

            const title = game.i18n.localize('SSM.T2P_Errors.evfw.title');
            const content = game.i18n.localize('SSM.T2P_Errors.evfw.content');
            const confirm = await confirmDialog(title, content);

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
     * Or the other point can be well within the explored area, but isn't part of the walls forming the
     * perimeter.  These are needed for later, but have to be omitted from the algorithm until they are needed.
     * @returns {boolean}           // Returns true if successful.
     */
    async #removeNonPerimeterWalls() {
        for (const [id, wall] of this.instanceWalls) {
            for (let i=0; i < wall.data.c.length; i+= 2) {
                const row = wall.data.c[i+1];
                const column = wall.data.c[i]; 
                const check = this.perimeterPixels.has(JSON.stringify([column, row]));
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
                            const offsetPixel = [column + offsetX, row + offsetY];
                            foundPerimeterPixel = this.perimeterPixels.has(JSON.stringify(offsetPixel));
                            if ( foundPerimeterPixel ) this.perimeterPixels.add([column, row]);

                        }
                    }

                    // If it didn't find a nearby perimeter pixel, then it might be outside the explored area, or inside.
                    if ( !foundPerimeterPixel ) {
                        const checkisExplored = this.#pixelIsExplored(column, row);
                        if ( checkisExplored ) {
                            // It is inside the explored area.  Need to keep the wall, but add it to this.omitWalls for later, but remove the vertex.
                            this.omitWalls.add(wall);
                            this.vertexCoords.delete(JSON.stringify([column, row]));
                        } else {
                            // It is outside the explored area.  Need to remove the wall and the vertex.
                            this.instanceWalls.delete(id);
                            this.vertexCoords.delete(JSON.stringify([column, row]));
                        }
                    }
                }
            }
        }

        if ( this.#isDebugging ) {
            for (let coord of this.vertexCoords) {
                const coords = JSON.parse(coord);
                this.populatePixiDots(coords, "0xFFE97F", 15);            
            }

            const title = game.i18n.localize('SSM.T2P_Errors.rnpw.title');
            const content = game.i18n.localize('SSM.T2P_Errors.rnpw.content');
            const confirm = await confirmDialog(title, content);

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

            const title = game.i18n.localize('SSM.T2P_Errors.epp.title');
            const content = game.i18n.localize('SSM.T2P_Errors.epp.content');
            const confirm = await confirmDialog(title, content);

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

        // Step 2: Special case: Two 'rooms' share a common wall.  Each endpoint is on the perimeter,
        // but the line between the end points is not.  These points (vertices) will have 3 walls in
        // their wall array.  Need to figure out which one is shared, remove it from each vertice and
        // add the wall to this.omitWalls, since it is actually an inside wall.
        const threeOrMoreWalls = newVertexArray.filter(obj => obj.walls.length > 2);
        for (const vertexObj1 of threeOrMoreWalls) {
            for (const vertexObj2 of threeOrMoreWalls) {
                if ( vertexObj1 === vertexObj2 ) continue;
                for (const wall1 of vertexObj1.walls) {
                    for (const wall2 of vertexObj2.walls) {
                        if ( wall1 === wall2 ) {
                            this.omitWalls.add(wall1);
                            const index1 = vertexObj1.walls.findIndex(e => e === wall1);
                            vertexObj1.walls.splice(index1, 1);
                            const index2 = vertexObj2.walls.findIndex(e => e === wall2);
                            vertexObj2.walls.splice(index2, 1);
                        }
                    }
                }
            }
        }

        // Step 3: Link walls
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
     * If 3 vertices form a straight line, the line only needs the vertices at the extremities to define it.
     * This method deletes excess vertices for a given line.
     * @returns {boolean}           // Returns true if successful
     */
    async #removeSameSlopeVertices() {

        // Start with a vertex that has only one reference to another vertex, if possible
        const startingVertex = this.vertexCoords.filter(v => v.first === undefined || v.second === undefined);
        // If there are no vertices with only one vertex reference, then just use the first in this.vertexCoords.
        if ( startingVertex.length === 0 ) {
            startingVertex.push(this.vertexCoords[0]);
        }
        
        let v0 = startingVertex[0];

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

            const title = game.i18n.localize('SSM.T2P_Errors.rssv.title');
            const content = game.i18n.localize('SSM.T2P_Errors.rssv.content');
            const confirm = await confirmDialog(title, content);

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
            // Find out which is greater: width or height.  For an edge edge case where one is 1 pixel larger than the other,
            // don't want to change the value twice.  So if we start with the larger value and add 1, it will never equal the smaller.
            const padPlusWidth = this.dims.sceneWidth + this.dims.paddingX - 1;
            const padPlusHeight = this.dims.sceneHeight + this.dims.paddingY - 1;
            const first =  padPlusWidth > padPlusHeight ? padPlusWidth : padPlusHeight;
            const second = first === padPlusWidth ? padPlusHeight : padPlusWidth;
            const ordered = [first, second];

            for (const bounds of limits) {
                if ( this.compressedPixelData[dir].has(bounds) ) {
                    const boundarySegments = this.compressedPixelData[dir].get(bounds); // Array of arrays.
                    let coord1 = [];
                    let coord2 = [];
                    for (const segment of boundarySegments) {
                        coord1 = dir === "horizontal" ? [segment[0], bounds] : [bounds, segment[0]];
                        coord2 = dir === "horizontal" ? [segment[1], bounds] : [bounds, segment[1]];
                        const coords = [coord1, coord2];

                        // This is where we figure out if x = sceneWidth or y = sceneHeight and add 1.
                        for (const coord of coords) {
                            coord[0] = coord[0] === ordered[0] ? coord[0] + 1 : coord[0];
                            coord[0] = coord[0] === ordered[1] ? coord[0] + 1 : coord[0];
                            coord[1] = coord[1] === ordered[0] ? coord[1] + 1 : coord[1];
                            coord[1] = coord[1] === ordered[1] ? coord[1] + 1 : coord[1];
                        }

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

            const title = game.i18n.localize('SSM.T2P_Errors.abv.title');
            const content = game.i18n.localize('SSM.T2P_Errors.abv.content');
            const confirm = await confirmDialog(title, content);

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

        function _link(v1, v2) {
            v1.second = JSON.parse(v2.coord);
            v2.second = JSON.parse(v1.coord);
            this.edgesNotFromWall.push([JSON.parse(v1.coord), JSON.parse(v2.coord)]);
        }

        const isPerimeter = _isPerimeter.bind(this);
        const link = _link.bind(this);
        
        // Find all vertices that are missing references
        let unlinkedVertices = this.vertexCoords.filter(v => v.first === undefined || v.second === undefined);
        // If there are none, then we're done.
        if ( !unlinkedVertices.length ) return true;
        // Safety check to make sure the do-while loop doesn't loop infinitely.
        let unlinkedCount = unlinkedVertices.length;
        let unlinkedCountStart = unlinkedCount + 1

        // Otherwise, start trying to determine which need to be linked to which.
        do {
            // Check to avoid infinite loop
            if ( unlinkedCount === unlinkedCountStart) {
                ui.notifications.error("Unable to link final walls.  Enable debugging to find issue.");
                return false;
            }
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
                    if ( JSON.stringify(P2) === JSON.stringify(vert1.first)) continue;
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

                    if ( update ) {
                        link(vert1, vert);
                        unlinkedCount -= 1;
                    }
                }
            } else {
                // Only two left.
                link(unlinkedVertices[0], unlinkedVertices[1]);
                unlinkedCount -= 1;
            }

            // We should have linked two vertices together.  Need to remove them from the array.
            unlinkedVertices = this.vertexCoords.filter(v => v.first === undefined || v.second === undefined);
            unlinkedCountStart -= 1;

        } while ( unlinkedVertices.length )

        return true;
    }

    #generateBoundingBox() {
        const smallestX = this.vertexCoords.reduce((pv, cv) => Math.min(pv, JSON.parse(cv.coord)[0]), this.dims.sceneWidth + this.dims.paddingX + 1);
        const smallestY = this.vertexCoords.reduce((pv, cv) => Math.min(pv, JSON.parse(cv.coord)[1]), this.dims.sceneHeight + this.dims.paddingY + 1);
        const offsetX = smallestX % this.dims.size;
        const offsetY = smallestY % this.dims.size;
        const largestX = this.vertexCoords.reduce((pv, cv) => Math.max(pv, JSON.parse(cv.coord)[0]), 0);
        const largestY = this.vertexCoords.reduce((pv, cv) => Math.max(pv, JSON.parse(cv.coord)[1]), 0);
        return {
            x: smallestX - offsetX,
            y: smallestY - offsetY,
            offsetX: offsetX,
            offsetY: offsetY,
            sceneX: smallestX - offsetX - this.dims.paddingX,
            sceneY: smallestY - offsetY - this.dims.paddingY,
            width: (largestX + offsetX) - smallestX,
            height: (largestY + offsetY) - smallestY,
            center: {
                x: (largestX - (smallestX - offsetX)) / 2,
                y: (largestY - (smallestY - offsetY)) / 2
            }
        }
    }

    /** Foundry core's drawing polygon method requires an ordered series of point coordinates in array form, ie: [x,y]
     *  It also normalizes the data points relative to the top left corner of a bounding box that contains all the vertices.
     *  Need an array of normalized vertex points, ordered such that the points define a perimeter and end at the same
     *  coordinate it started.
     * @return {promise}      
     */
     async #prepareVertexData() {

        const orderedArray = [];

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
            return [coord[0] - this.boundingBox.x, coord[1] - this.boundingBox.y];
        })

        if ( this.#isDebugging ) {
            let points = []
            for (const pt of this.polygonVertexCoordinates) {
                points = [...points, ...pt];
            }
            const poly = new PIXI.Polygon(points);
            const graphics = new PIXI.LegacyGraphics();
            graphics.x = this.boundingBox.x;
            graphics.y = this.boundingBox.y;
            graphics.beginFill(0xFF0000, .5);
            graphics.drawPolygon(poly);
            graphics.endFill();
            canvas.stage.addChild(graphics);

            const title = game.i18n.localize('SSM.T2P_Errors.pvd.title');
            const content = game.i18n.localize('SSM.T2P_Errors.pvd.content');
            const confirm = await confirmDialog(title, content);

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
            x: this.dims.paddingX + this.dims.sceneWidth / 2,
            y: this.dims.paddingY + this.dims.sceneHeight / 2
        }
        const R = Math.round(((box.center.x + box.sceneX) / this.dims.sceneWidth) * 255);
        const G = Math.round(((box.center.y + box.sceneY) / this.dims.sceneHeight) * 255);
        const maxB = lineLength(sceneCenter, {x: this.dims.paddingX, y: this.dims.paddingY});
        const B = Math.round((lineLength(sceneCenter, {x: box.center.x + box.sceneX, y: box.center.y + box.sceneY}) / maxB) * 255);
                                
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
                //text: this.subSceneName,
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

    #cleanup() {
        canvas.stage.removeChild(this.tempContainer);
        this.tempContainer.destroy(true);
        this.tempContainer = undefined;
        this.mask = undefined;
        this.dims = undefined;
        this.pixels = undefined // just in case
        this.compressedPixelData = undefined;
        this.vertexCoords = undefined;
        this.perimeterPixels = undefined;
        this.parent = undefined;
    }
}
