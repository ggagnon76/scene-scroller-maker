import { ModuleName } from "../ssm-launch.js";
import { log } from "./functions.js";

export class Texture2Polygon {
    constructor(name) {
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
    }

    async generateDrawingPolygon() {
        this.tex = this.getTexWithAlpha(); 
        this.perimeterPixels = new Set(this.getPerimeterPixelsFromTexture(this.tex));
        this.getVertices();
        this.drawingID = await this._generateDrawingPolygon();
    }


    get isDebugging() {
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
        const alphaThreshold = 100;
        const pixels = canvas.app.renderer.extract.pixels(this.texDebugContainer);
        canvas.stage.addChild(this.pixelsDebugContainer);
        this.pixelsDebugContainer.x = d.paddingX;
        this.pixelsDebugContainer.y = d.paddingY;


        function _notAlpha(set, x, y, vertical = true) {
            const d = canvas.dimensions;
            let offset = isAlpha ? (vertical ? y : x) : (vertical ? y - 1 : x - 1);
            if (offset < 0) offset = 0;
            if ( vertical === true && y === d.sceneHeight) offset = y;
            if ( vertical === false && x === d.sceneWidth) offset = x;
            const coords = [(vertical ? x : offset), (vertical ? offset : y)];
            set.add(JSON.stringify(coords));
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

        let isAlpha = true;

        for (let i = 0; i <= d.sceneWidth; i++) {
            for (let j = 0; j <= d.sceneHeight; j++) {
                const alphaIndex = ((j * d.sceneWidth + i) * 4) + 3;
                const checkIsAlpha = pixels[alphaIndex] < alphaThreshold;
                isAlpha = isAlpha === checkIsAlpha ? isAlpha : notAlpha(perimeterPixels, i, j, true);
            }

            if ( !isAlpha ) {
                isAlpha = notAlpha(perimeterPixels, i, d.sceneHeight, true);
            }
        }

        const smallY = [...perimeterPixels].reduce((prev, curr) => Math.min(prev, JSON.parse(curr)[1]), d.sceneWidth);
        const bigY = [...perimeterPixels].reduce((prev, curr) => Math.max(prev, JSON.parse(curr)[1]), 0);

        isAlpha = true;
        for (let j = smallY; j <= bigY; j++) {
            for (let i = 0; i <= d.sceneWidth; i++) {
                const alphaIndex = ((j * d.sceneWidth + i) * 4) + 3;
                const checkIsAlpha = pixels[alphaIndex] < alphaThreshold;
                isAlpha = isAlpha === checkIsAlpha ? isAlpha : notAlpha(perimeterPixels, i, j, false);
            }

            if ( !isAlpha ) {
                isAlpha = notAlpha(perimeterPixels, d.sceneWidth, j, false);
            }
        }

        this.texDebugContainer.alpha = 0;
        if ( this.isDebugging ) {
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

        if ( this.isDebugging ) {
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