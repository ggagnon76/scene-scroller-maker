import { ModuleName } from "../ssm-launch.js";
import { log } from "./functions.js";

export class Texture2Polygon {

    texDebugContainer = null;
    pixelsDebugContainer = null;
    perimeterPixels = null;
    vertices = null;



    static get isDebugging() {
        return game.modules.get('_dev-mode')?.api?.getPackageDebugValue(ModuleName);
    }

    static getTexWithAlpha() {

        const d = canvas.dimensions;

        this.texDebugContainer = new PIXI.Container();
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

        // This bit is for debugging purposes.  It helps visualize if the result is correct.
        if ( this.isDebugging ) {
            canvas.stage.addChild(this.texDebugContainer);
            this.texDebugContainer.alpha = 0.75;
        }
        return texture;
    }

    static getPerimeterPixelsFromTexture() {

        const d = canvas.dimensions;
        let isAlpha = true;
        const alphaThreshold = 100;
        const pixels = canvas.app.renderer.extract.pixels(this.texDebugContainer);

        this.pixelsDebugContainer = new PIXI.Container();
        this.perimeterPixels = new Set();


        // This bit is for debugging purposes.  It helps visualize if the result is correct.
        if ( this.isDebugging ) {
            canvas.stage.addChild(this.pixelsDebugContainer);
            this.pixelsDebugContainer.x = d.paddingX;
            this.pixelsDebugContainer.y = d.paddingY;
            this.pixelsDebugContainer.alpha = 0.75;
        }

        function _notAlpha(x, y, vertical = true) {
            const d = canvas.dimensions;
            let offset = isAlpha ? (vertical ? y : x) : (vertical ? y - 1 : x - 1);
            if (offset < 0) offset = 0;
            if ( vertical === true && y === d.sceneHeight) offset = y;
            if ( vertical === false && x === d.sceneWidth) offset = x;
            const coords = [(vertical ? x : offset), (vertical ? offset : y)];
            this.perimeterPixels.add(JSON.stringify(coords));
            if ( this.isDebugging ) {
                const pixelDot = new PIXI.LegacyGraphics();
                pixelDot.beginFill(0xFF0000);
                pixelDot.drawCircle(coords[0],coords[1], 2);
                pixelDot.endFill();
                this.pixelsDebugContainer.addChild(pixelDot);
            }
            return !isAlpha;
        }

        const notAlpha = _notAlpha.bind(this);

        for (let i = 0; i <= d.sceneWidth; i++) {
            for (let j = 0; j <= d.sceneHeight; j++) {
                const alphaIndex = ((j * d.sceneWidth + i) * 4) + 3;
                const checkIsAlpha = pixels[alphaIndex] < alphaThreshold;
                isAlpha = isAlpha === checkIsAlpha ? isAlpha : notAlpha(i, j, true);
            }

            if ( !isAlpha ) {
                isAlpha = notAlpha(i, d.sceneHeight, true);
            }
        }

        const smallY = [...this.perimeterPixels].reduce((prev, curr) => Math.min(prev, JSON.parse(curr)[1]), d.sceneWidth);
        const bigY = [...this.perimeterPixels].reduce((prev, curr) => Math.max(prev, JSON.parse(curr)[1]), 0);

        isAlpha = true;
        for (let j = smallY; j <= bigY; j++) {
            for (let i = 0; i <= d.sceneWidth; i++) {
                const alphaIndex = ((j * d.sceneWidth + i) * 4) + 3;
                const checkIsAlpha = pixels[alphaIndex] < alphaThreshold;
                isAlpha = isAlpha === checkIsAlpha ? isAlpha : notAlpha(i, j, false);
            }

            if ( !isAlpha ) {
                isAlpha = notAlpha(d.sceneWidth, j, false);
            }
        }

        if ( this.isDebugging ) log(false, this.perimeterPixels);

        this.vertices = new Map();
    }

    /** A recursive function that uses various logic to find vertices in the premiterPixels Set.
     *  Once a vertex has been found, the points used to determine the location of that vertex
     *  is deleted from the perimeterPixels Set and then the function calls itself again.
     */
    static getVertices() {

        const d = canvas.dimensions;
        const edgeThreshold = 10; // minimum quantity of pixels to form an edge between vertices.
        let ptsBetweenVertices = [];

        //First, check the 4 corners of the scene.  If a pixel is found there, then it is automatically a vertex.
        const corners = [[0,0], [d.sceneWidth, 0], [d.sceneWidth , d.sceneHeight], [0,d.sceneHeight]];

        function _checkCoord(coord) {
            if ( this.perimeterPixels.has(JSON.stringify(coord)) ) {
                this.vertices.set(coord, {first: null, second: null});
                this.perimeterPixels.delete(JSON.stringify(coord))
                log(false, ["Added vertex: ", coord])
                return this.getVertices();
            }
        }

        const checkCoord = _checkCoord.bind(this)

        for (const corner of corners) {
            checkCoord(corner);
        }
        
        // If there are no pixels in the corners, then find the smallest X with the smallest Y.  That will be the first vertex.
        // It so happens that the way the perimeterPixels Set was built, the first entry is the smallest X with the smallest Y!
        if ( !this.vertices.size ) {
            const [first] = this.perimeterPixels;
            checkCoord(JSON.parse(first))
        }

        // By this point, we should have at least 1 vertex.  We begin with the first vertex in the map, and check for:
        // Has it already been populated?  If so, skip to the next, and,
        // Does it have horizontal neighboring points (+ and -), OR
        // Does it have vertical neighboring points (+ and -)?
        // If we find neither horizontal or vertical neighbors, then we try the same for the next vertex.
        // When we run out of vertices, we move on.
        function _hasOrthoNeighbor(coord, dir, horizontal = true) {

            const x = horizontal ? dir : 0;
            const y = horizontal ? 0 : dir;
            const newCoord = [coord[0] + x, coord[1] + y];

            if ( this.perimeterPixels.has(JSON.stringify(newCoord)) ) {
                ptsBetweenVertices.push(newCoord);
                return hasOrthoNeighbor(newCoord, dir, horizontal);
            }

            return coord;
        }

        function _cleanUpPixels(currentKey, currentValue, newCoord) {
            // Delete all the points between value and output
            for (const pts of ptsBetweenVertices) {
                if ( !this.perimeterPixels.delete(JSON.stringify(pts)) ) log(false, ["Tried to delete pixel point that didn't exist: ", pts]);
            }

            ptsBetweenVertices = [];

            if (currentValue.first === null) this.vertices.set(currentKey, {first: newCoord, second: null});
            else this.vertices.set(currentKey, {first: CurrentValue.first, second: newCoord});

            this.vertices.set(newCoord, {first: currentKey, second: null});
            log(false, ["Added vertex: ", newCoord])

            return this.getVertices();
        }

        const hasOrthoNeighbor = _hasOrthoNeighbor.bind(this);
        const cleanUpPixels = _cleanUpPixels.bind(this);

        this.vertices.forEach((value, key) => {
            // Has it already been populated?
            if ( value.first !== null || value.second !== null) return;

            const directions = [-1, 1];
            // Horizontal first
            for (const dir of directions) {
                const output = hasOrthoNeighbor(key, dir, true);
                if ( JSON.stringify(output) === JSON.stringify(key) ) continue;
                // Distance between the two coordinates
                const dist = Math.sqrt(Math.pow(output[0] - key[0], 2) + Math.pow(output[1] - key[1], 2));
                if ( dist < edgeThreshold ) continue;

                // output is a new vertex!
                cleanUpPixels(key, value, output);
            }
            // Vertical next
            for (const dir of directions) {
                const output = hasOrthoNeighbor(key, dir, false);
                if ( output === key ) continue;
                // Distance between the two coordinates
                const dist = Math.sqrt(Math.pow(output[0] - key[0], 2) + Math.pow(output[1] - key[1], 2));
                if ( dist < edgeThreshold ) continue;

                // output is a new vertex!
                cleanUpPixels(key, value, output);
            }

            if ( this.isDebugging ) {
                this.pixelsDebugContainer.removeChildren();
                for (const coord of this.perimeterPixels) {
                    const coords = JSON.parse(coord);
                    const pixelDot = new PIXI.LegacyGraphics();
                    pixelDot.beginFill(0xFF0000);
                    pixelDot.drawCircle(coords[0],coords[1], 2);
                    pixelDot.endFill();
                    this.pixelsDebugContainer.addChild(pixelDot);
                }

                for (const [value, key] of this.vertices) {
                    const vertexDot = new PIXI.LegacyGraphics();
                    vertexDot.beginFill(0xFFE97F);
                    vertexDot.drawCircle(value[0],value[1], 15);
                    vertexDot.endFill();
                    this.pixelsDebugContainer.addChild(vertexDot);
                }
            }
        })
    }
}