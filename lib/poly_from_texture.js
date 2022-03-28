import { ModuleName } from "../ssm-launch.js";
import { log } from "./functions.js";

export class Texture2Polygon {

    texDebugContainer = null;
    pixelsDebugContainer = null;
    perimeterPixels = null;
    vertices = null;
    isCornersDone = false;




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
        //If the 4 corners have been checked, skip this block on further iterations/recursions.
        this.isCornersDone = false;
        if ( !this.isCornersDone ) {
            const corners = [[0,0], [d.sceneWidth, 0], [d.sceneWidth , d.sceneHeight], [0,d.sceneHeight]];

            function _checkCoord(coord) {
                if ( this.perimeterPixels.has(JSON.stringify(coord)) ) {
                    this.vertices.set(JSON.stringify(coord), {first: null, second: null});
                    this.perimeterPixels.delete(JSON.stringify(coord))
                    log(false, ["Added vertex: ", coord])
                    return true;
                }
                return false
            }

            const checkCoord = _checkCoord.bind(this)

            for (const corner of corners) {
                const check = checkCoord(corner);
                if ( check ) return this.getVertices();
            }

            this.isCornersDone = true;
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
            const newCoord = [JSON.parse(coord)[0] + x, JSON.parse(coord)[1] + y];

            if ( this.perimeterPixels.has(JSON.stringify(newCoord)) ) {
                ptsBetweenVertices.push(newCoord);
                return hasOrthoNeighbor(JSON.stringify(newCoord), dir, horizontal);
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
            if ( this.vertices.has(JSON.stringify(currentKey)) ) {
                log(false, ["Updating vertex: ", newCoord]);
            } else {
                log(false, ["Adding vertex: ", newCoord]);
            }
            if (currentValue.first === null) this.vertices.set(JSON.stringify(currentKey), {first: newCoord, second: null});
            else this.vertices.set(JSON.stringify(currentKey), {first: currentValue.first, second: newCoord});

            this.vertices.set(JSON.stringify(newCoord), {first: currentKey, second: null});
        }

        const hasOrthoNeighbor = _hasOrthoNeighbor.bind(this);
        const cleanUpPixels = _cleanUpPixels.bind(this);
        const populateVertex = _populateVertex.bind(this);

        this.vertices.forEach((value, key) => {
            // Has this vertex already been fully defined?
            if ( value.first !== null && value.second !== null) return;

            const directions = [-1, 1];
            // Horizontal first
            for (const dir of directions) {
                const outputString = hasOrthoNeighbor(key, dir, true);
                if ( outputString === key ) continue;
                // Distance between the two coordinates
                const output = JSON.parse(outputString);
                const input = JSON.parse(key);
                const dist = Math.sqrt(Math.pow(output[0] - input[0], 2) + Math.pow(output[1] - input[1], 2));
                if ( dist < edgeThreshold ) continue;

                // output is a new vertex, unless there is already a vertex at the next pixel.
                const adjacentVertex = hasOrthoVertex(outputString, dir, true);
                if ( adjacentVertex ) {
                    populateVertex(JSON.parse(key), value, JSON.parse(adjacentVertex));
                } else {
                    populateVertex(JSON.parse(key), value, JSON.parse(outputString));
                }
                cleanUpPixels();
                return this.getVertices();
            }
            // Vertical next
            for (const dir of directions) {
                const outputString = hasOrthoNeighbor(key, dir, false);
                if ( outputString === key ) continue;
                // Distance between the two coordinates
                const output = JSON.parse(outputString);
                const input = JSON.parse(key);
                const dist = Math.sqrt(Math.pow(output[0] - input[0], 2) + Math.pow(output[1] - input[1], 2));
                if ( dist < edgeThreshold ) continue;

                // output is a new vertex, unless there is already a vertex at the next pixel.
                const adjacentVertex = hasOrthoVertex(outputString, dir, false);
                if ( adjacentVertex ) {
                    populateVertex(JSON.parse(key), value, JSON.parse(adjacentVertex));
                } else {
                    populateVertex(JSON.parse(key), value, JSON.parse(outputString));
                }
                cleanUpPixels();
                return this.getVertices();
            }
        })

        // At this point, we may have incomplete vertices and pixelPoints remaining.  Those points can 
        // represent angled lines, or curves.
        // Utility functions:

        function _getAdjacentPoint(vertex, wrong =  null) {
            const pixelOffset = [-1, 0, 1];
            for (const offsetX of pixelOffset) {
                for (const offsetY of pixelOffset) {
                    if ( offsetX === 0 && offsetY === 0 ) continue;
                    const newCoord = [JSON.parse(vertex)[0] + offsetX, JSON.parse(vertex)[1] + offsetY];
                    if ( JSON.stringify(newCoord) === JSON.stringify(wrong) ) continue;

                    if ( this.perimeterPixels.has(JSON.stringify(newCoord)) ) return newCoord;
                }
            }

            return false;
        }

        const getAdjacentPoint = _getAdjacentPoint.bind(this);

        function fillArray(arr, {coord = null, wrong = null}={}) {
            if ( arr.length === 0 && coord === null) {
                log(false, "fillArray function missing coordinates for first pass.");
                return;
            }
            if ( arr.length === edgeThreshold ) return arr;
            
            const newCoord = arr.length === 0 ? getAdjacentPoint(coord, {wrong: wrong}) : getAdjacentPoint(JSON.stringify(arr[arr.length - 1]), {wrong: JSON.stringify(arr[arr.length - 2])});
            if ( newCoord === false ) return arr;
            arr.push(newCoord);
            return fillArray(arr);
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
            const newPt = getAdjacentPoint(JSON.stringify(leadCar[lastIndex]), {wrong: leadCar[lastIndex]});
            if ( newPt === false ) {
                ui.notification.error("Add code to check for vertex (leadCar).  Ran out of points before finding vertex in findVertex.");
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


        // The following block tries to find vertices for non-orthogonal straight series of points.
        // Best way to picture this algorithm is:  
        //   - The points are a railway track
        //   - On this track, there are two train cars, connected together by a hinge.  These train cars are arrays
        //   - These train cars have a length in points (track) defined by the edgeThreshold variable, defined above.
        //   - All the points (track) covered by the arrays (train cars) belong to those arrays.
        //   - When the train cars are aligned (their slopes are equal) on a straight track, we know there are no vertices to find.
        //     so we keep moving the train forward.
        //   - When the train moves forward, any points (track) that falls out of the second array (trailing car),
        //     gets saved to the ptsBetweenVertices array to be used once a vertex is found.
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
        //        the largest into a Set.  We use a Set because entries have to be unique.
        //      - A corner should always be the furthest point between the leading point of the first array and the trailing point of the
        //        second array.
        //   - We will keep moving forward until we end up with more than one entry in the Set, in which case we assume its a curve, OR
        //     there is only one entry in the set AND that entry becomes the first point in the second array (the trailing car).
        //      - When this condition is met, we create a vertex at that point.  Delete the points in ptsBetweenVertices and then
        //        recursively call getVertices() all over again.

        if ( this.isDebugging ) {
            log(false, this.perimeterPixels);
            log(false, this.vertices);
        }

        let debuggingCheck = false;

        this.vertices.forEach((value, vertexCoord) => {
            // Has this vertex already been fully defined?
            if ( value.first !== null && value.second !== null) return;
            if ( debuggingCheck ) return;

            // Going to start moving the arrays (train car(s)) from the known vertex over the points (track).
            ptsBetweenVertices = [];
            let leadCar = [];
            let trailingCar = [];
            const lastIndex = edgeThreshold - 1;
            let isMaybeVertex = new Set();

            fillArray(trailingCar, {coord: vertexCoord});

            if ( trailingCar.length === edgeThreshold ) {
                // Start filling the first array (lead car)
                fillArray(leadCar, {coord: JSON.stringify(trailingCar[lastIndex]), wrong: trailingCar[lastIndex]});
                if ( leadCar.length === edgeThreshold ) {

                    // Now we start trying to find a vertex.
                    let foundVertex = "";
                    do {
                        foundVertex = findVertex(trailingCar, leadCar, lastIndex, isMaybeVertex);
                    } while ( foundVertex === "iterate");
                    if ( !foundVertex ) return  // Step to the next known vertex
                    if ( foundVertex === "isVertex" ) {
                        cleanUpPixels();
                        populateVertex(vertexCoord, value, trailingCar[0]);

                        // Debugging.  Following shouldn't go here:
                        debuggingCheck = true;
                    }

                } else {
                    // Not enough points?  Check if there's a vertex
                    ui.notifications.error("Add code to check for vertex (leadCar).  Fewer points than edgeThreshold.");
                }
            } else {
                // Not enough points?  Check if there's a vertex
                ui.notifications.error("Add code to check for vertex (ptsBetweenVertices).  Fewer points than edgeThreshold.");
            }

        })

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

            for (const [values, key] of this.vertices) {
                const value = JSON.parse(values);
                const vertexDot = new PIXI.LegacyGraphics();
                vertexDot.beginFill(0xFFE97F);
                vertexDot.drawCircle(value[0],value[1], 15);
                vertexDot.endFill();
                this.pixelsDebugContainer.addChild(vertexDot);
            }
        }
    }
}