import { flattenClipperPoints } from "./functions.js";

export class Texture2Polygon {
    constructor(parent) {
        this.parent = parent;
        this.subSceneName = parent.inWorkDivTitle;
        this.polygonPaths = [...parent.polygonPaths].map(p => JSON.parse(p));
        this.clipperPathFinal = undefined;
        this.pixiPolygon = undefined;
        this.wallsInDiv = [];
        this.tempContainer = new PIXI.Container();
        this.dims = canvas.dimensions;
        this.boundingBox = {};
        this.drawingColor = undefined;
        this.drawingID = undefined;
        this.foregroundSrc = null;

        canvas.stage.addChild(this.tempContainer);
    }

    async generateDrawingPolygon() {

        // Generate (union if necessary) a polygon for the explored area.
        this.clipperPathFinal = this.#unionPolygons(this.clipperPathFinal, this.polygonPaths);

        // Difference all previous division polygons to prevent division overlap.
        if ( this.parent.divisions.length ) {
            this.#differencePolygons();
        }

        // Generate boundingBox data for the polygon
        this.boundingBox = await this.#generateBoundingBox();

        // Save an array of all the walls that are contained in this division, for future use
        this.#wallsInDiv();

        // Generate a PIXI polygon to display the already covered area
        this.drawingID = await this.#generateDrawingPolygon();

        return true;
    }

    #unionPolygons(subjectPath, clipPaths) {

        // In case this is the first time this is being called
        if ( subjectPath === undefined ) {
            subjectPath = PolygonMesher.getClipperPathFromPoints(clipPaths.shift());
        }

        // Union all extra polygons that were recorded.
        if ( clipPaths.length ) {
            const union_paths = new ClipperLib.Paths();
            for (const path of clipPaths) {
                const union_path = PolygonMesher.getClipperPathFromPoints(path);
                union_paths.push(union_path);
            }

            const union_cpr = new ClipperLib.Clipper();
            union_cpr.AddPath(subjectPath, ClipperLib.PolyType.ptSubject, true);
            union_cpr.AddPaths(union_paths, ClipperLib.PolyType.ptClip, true);

            const union_clipType = ClipperLib.ClipType.ctUnion;
            const union_fillType = ClipperLib.PolyFillType.pftNonZero;
            union_cpr.Execute(union_clipType, subjectPath, union_fillType, union_fillType);
        }

        return subjectPath
    }

    #differencePolygons() {
        const diff_paths = new ClipperLib.Paths();
            for (const division of this.parent.divisions) {
                // check to see if there is even an intersection area to remove
                const source = flattenClipperPoints(this.clipperPathFinal[0]);
                const clipPaths = [flattenClipperPoints(division.clipperPathFinal[0])];
                const checkForPath = this.#unionPolygons(source, clipPaths);
                // If there is an polygon resulting from the intersection, then
                if ( checkForPath.length ) diff_paths.push(division.clipperPathFinal[0]);
            }

            // If there are no paths, just exit.
            if ( !diff_paths.length ) return;

            const diff_cpr = new ClipperLib.Clipper();
            diff_cpr.AddPath(this.clipperPathFinal[0], ClipperLib.PolyType.ptSubject, true);
            diff_cpr.AddPaths(diff_paths, ClipperLib.PolyType.ptClip, true);

            const diff_clipType = ClipperLib.ClipType.ctDifference;
            const diff_fillType = ClipperLib.PolyFillType.pftNonZero;

            diff_cpr.Execute(diff_clipType, this.clipperPathFinal, diff_fillType, diff_fillType);
    }

    async #generateBoundingBox() {
        const d = canvas.dimensions;
        const tex = await loadTexture(canvas.scene.background.src);
        const path = Array.isArray(this.clipperPathFinal[0]) ? this.clipperPathFinal[0] : this.clipperPathFinal
        const smallestX = path.reduce((pv, cv) => Math.min(pv, cv.X), this.dims.sceneWidth + this.dims.sceneX + 1);
        const smallestY = path.reduce((pv, cv) => Math.min(pv, cv.Y), this.dims.sceneHeight + this.dims.sceneY + 1);
        const offsetX = smallestX % this.dims.size;
        const offsetY = smallestY % this.dims.size;
        const largestX = path.reduce((pv, cv) => Math.max(pv, cv.X), 0);
        const largestY = path.reduce((pv, cv) => Math.max(pv, cv.Y), 0);
        return {
            x: smallestX - offsetX,
            y: smallestY - offsetY,
            offsetX: offsetX,
            offsetY: offsetY,
            sceneX: smallestX - offsetX - this.dims.sceneX,
            sceneY: smallestY - offsetY - this.dims.sceneY,
            width: (largestX + offsetX) - smallestX,
            height: (largestY + offsetY) - smallestY,
            center: {
                x: (largestX - (smallestX - offsetX)) / 2,
                y: (largestY - (smallestY - offsetY)) / 2
            },
            texScaleWidth : d.sceneWidth / tex.width,
            texScaleHeight : d.sceneHeight / tex.height
        } 
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
        const R = box.center.x / this.dims.sceneWidth;
        const G = box.center.y / this.dims.sceneHeight;
        const maxB = lineLength(sceneCenter, {x: 0, y: 0});
        const currB = lineLength(sceneCenter, {x: box.center.x, y: box.center.y})
        const B = currB/ maxB;
                                
        // convert RGB to HEX string.  Found at https://stackoverflow.com/questions/5623838/rgb-to-hex-and-hex-to-rgb
        const rbgToHex = (R, G, B) => '#' + [R, G, B].map(x => {
            const hex = x.toString(16);
            return hex.length === 1 ? '0' + hex : hex;
        }).join('');

        return  {
            hexNum : PIXI.utils.rgb2hex([R, G, B]),
            hexStr : rbgToHex(Math.round(R * 255), Math.round(G * 255), Math.round(B * 255))
        }
        
    }

    #generatePixiPolygon(points) {
        let x = true;
        const newPoints = []
        for (const pt of points) {
            if ( x ) newPoints.push(pt + this.boundingBox.offsetX)
            else newPoints.push(pt + this.boundingBox.offsetY)
            x = !x
        }

        return new PIXI.Polygon(newPoints)
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
                fillType: 1,
                fillColor: this.drawingColor || game.user.color,
                strokeColor: this.drawingColor || game.user.color
            }, {overwrite: true, inplace: false});

            // Mandatory additions
            data.x = Math.round(origin.x);
            data.y = Math.round(origin.y);
            data.author = game.user.id;

            data.type = CONST.DRAWING_TYPES.POLYGON;
            data.points = [[origin.x - data.x, origin.y - data.y]];

            return data
        }

        const getNewDrawingData = _getNewDrawingData.bind(this);

        this.drawingColor = this.getColor(this.boundingBox).hexStr
        const document = new DrawingDocument(getNewDrawingData({x: this.boundingBox.x, y: this.boundingBox.y}), {parent: canvas.scene});
        const path = Array.isArray(this.clipperPathFinal[0]) ? this.clipperPathFinal[0] : this.clipperPathFinal
        document.shape.points = flattenClipperPoints(path);
        document.shape.height = this.boundingBox.height;
        document.shape.width = this.boundingBox.width;
        let drawingDoc = new Drawing(document);

        const data = drawingDoc.document.toObject(false);
        data.x = data.y = 0;
        const cls = getDocumentClass("Drawing");
        const createData = Drawing.normalizeShape(data);
        this.pixiPolygon = this.#generatePixiPolygon(createData.shape.points);
        const drawing = await cls.create(createData, {parent: canvas.scene});
        const o = drawing.object;

        return o.id
    }

    #wallsInDiv() {
        const allWallsData = canvas.walls.placeables;
        for (const wall of allWallsData) {
            const pt1 = new ClipperLib.IntPoint(wall.document.c[0], wall.document.c[1]);
            const pt2 = new ClipperLib.IntPoint(wall.document.c[2], wall.document.c[3]);

            if (    ClipperLib.Clipper.PointInPolygon(pt1, this.clipperPathFinal[0]) === 0 ||
                    ClipperLib.Clipper.PointInPolygon(pt2, this.clipperPathFinal[0]) === 0 ) continue;

            this.wallsInDiv.push(wall);                            
        }
    }
}