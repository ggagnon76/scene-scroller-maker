import { ModuleName, ModuleTitle } from "../ssm-launch.js";
import { SSM_SceneDivider, SSM_ConvertImage, SSM_ResizeImage, SSM_CropImage } from "./forms.js";

/** A wrapper function that works with the Foundryvtt-devMode module to output debugging info
 *  to the console.log, when a debugging boolean is activated in devMode module settings.
 *  Or the code can pass TRUE to the force argument to output to console.log regardless of the debugging boolean.
 *  @param {Boolean}    force   - A manual bypass to force output regardless of the debugging boolean
 *  @param {}           args    - The content to be output to console.log
 *  @return {void}
 */
 export function log(force, content) {
    try {
        const isDebugging = game.modules.get('_dev-mode')?.api?.getPackageDebugValue(ModuleName);

        if ( isDebugging ) {
            console.log(ModuleTitle,  " debugging | ", content);
        } else if ( force ) {
            console.log(ModuleTitle, " | ", content)
        }
    } catch (e) {}
}

export async function wait(ms) {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
    }

/** This function populates the menu buttons.  See getModuleToolGroups hook in ssm-launch.js.
 *  @param {Object}     - toolGroup
 *  @return {void}
 */
export function populateMenuButtons(toolGroup) {
    toolGroup.push(
        {
        name: game.i18n.localize('SSM.MenuButtons.ImageTools.name'),
        icon: "<i class='fas fa-image'></i>",
        title: game.i18n.localize('SSM.MenuButtons.ImageTools.title'),
        button: false,
        tools: [
            {
                name: game.i18n.localize('SSM.MenuButtons.Tools.ConvertImgFile.name'),
                title: game.i18n.localize('SSM.MenuButtons.Tools.ConvertImgFile.title'),
                icon: "<i class='fas fa-file-image'></i>",
                button: true,
                onClick: convertImgFile
            },
            {
                name: game.i18n.localize('SSM.MenuButtons.Tools.ConvertImgFolder.name'),
                title: game.i18n.localize('SSM.MenuButtons.Tools.ConvertImgFolder.title'),
                icon: "<i class='fas fa-folder'></i>",
                button: true,
                onClick: convertImgsInFolder
            },
            {
                name: game.i18n.localize('SSM.MenuButtons.Tools.ResizeImg.name'),
                title: game.i18n.localize('SSM.MenuButtons.Tools.ResizeImg.title'),
                icon: "<i class='fas fa-compress'></i>",
                button: true,
                onClick: resizeImage
            },
            {
                name: game.i18n.localize('SSM.MenuButtons.Tools.CropImg.name'),
                title: game.i18n.localize('SSM.MenuButtons.Tools.CropImg.title'),
                icon: "<i class='fas fa-crop-alt'></i>",
                button: true,
                onClick: cropImage
            }
        ]
        },
        {
        name: game.i18n.localize('SSM.MenuButtons.SceneTools.name'),
        title: game.i18n.localize('SSM.MenuButtons.SceneTools.title'),
        icon: "<i class='fas fa-sliders-h'></i>",
        button: false,
        tools: [
            {
                name: game.i18n.localize('SSM.MenuButtons.Tools.ConvertBackground.name'),
                title: game.i18n.localize('SSM.MenuButtons.Tools.ConvertBackground.title'),
                icon: "<i class='fas fa-image'></i>",
                button: true,
                onClick: convertBackground
            },
            {
                name: game.i18n.localize('SSM.MenuButtons.Tools.ScaleScene.name'),
                title: game.i18n.localize('SSM.MenuButtons.Tools.ScaleScene.title'),
                icon: "<i class='fas fa-compress-arrows-alt'></i>",
                button: true,
                onClick: scaleScene
            },
            {
                name: game.i18n.localize('SSM.MenuButtons.Tools.SceneDivider.name'),
                icon: "<i class='fas fa-puzzle-piece'></i>",
                title: game.i18n.localize('SSM.MenuButtons.Tools.SceneDivider.title'),
                onClick: spawnDividerForm,
                button: true
            }
        ]
        },
        {
        name: game.i18n.localize('SSM.MenuButtons.TileNudge.name'),
        icon: "<i class='fas fa-arrows-alt'></i>",
        title: game.i18n.localize('SSM.MenuButtons.TileNudge.title'),
        button: false,
        tools:  [
            {
                name: game.i18n.localize('SSM.MenuButtons.Tools.NudgeUp.name'),
                title: game.i18n.localize('SSM.MenuButtons.Tools.NudgeUp.title'),
                icon: "<i class='fas fa-arrow-up'></i>",
                onClick: nudgeTileUP,
                button: true
            },
            {
                name: game.i18n.localize('SSM.MenuButtons.Tools.NudgeLeft.name'),
                title: game.i18n.localize('SSM.MenuButtons.Tools.NudgeLeft.title'),
                icon: "<i class='fas fa-arrow-left'></i>",
                onClick: nudgeTileLEFT,
                button: true
            },
            {
                name: game.i18n.localize('SSM.MenuButtons.Tools.NudgeRight.name'),
                title: game.i18n.localize('SSM.MenuButtons.Tools.NudgeRight.title'),
                icon: "<i class='fas fa-arrow-right'></i>",
                onClick: nudgeTileRIGHT,
                button: true
            },
            {
                name: game.i18n.localize('SSM.MenuButtons.Tools.NudgeDown.name'),
                title: game.i18n.localize('SSM.MenuButtons.Tools.NudgeDown.title'),
                icon: "<i class='fas fa-arrow-down'></i>",
                onClick: nudgeTileDOWN,
                button: true
            }
        ]
    });

    if ( game.modules.get("scene-scroller").active ) {
        toolGroup.push({
            name: game.i18n.localize('SSM.MenuButtons.CreateLinks.name'),
            title: game.i18n.localize('SSM.MenuButtons.CreateLinks.title'),
            icon: "<i class='fas fa-link'></i>",
            button: true,
            onClick: linkScenes
        })
    }
}

/** Returns a compendium scene document when given a pack name and scene name
 * @param {string}  pack    - The name of the compendium pack
 * @param {string}  scene   - The name of the scene in the above compendium pack
 * @returns {object}        - SceneDocument?
 */
 export async function getSource(pack, scene) {
    const compndm = game.packs.filter(p => p.title === pack)[0];
    const clctn = compndm.collection;
    const scn_id = compndm.index.getName(scene)._id;
    const uuid = `Compendium.${clctn}.${scn_id}`;
    const source = await fromUuid(uuid);
    return source;
}

const debouncedTileTranslation = foundry.utils.debounce((updates) => {
    canvas.scene.updateEmbeddedDocuments("Tile", updates);
    log(false, "updateEmbeddedDocuments for Tile translation submitted to server.");
}, 3000);

function spawnDividerForm() {
    new SSM_SceneDivider({height: "auto"}).render(true);
}

function convertBackground() {
    ui.notifications.info("Clicked convert background button.");
}

async function saveImgAsWebP(img, imgPath, compression) {
    const image = canvas.app.renderer.extract.base64(new PIXI.Sprite(img), "image/webp", compression);
    const blob = convertToBlob(image);

    // Save to disk
    const fileNameExtract = imgPath.split("/").pop();
    const fileExtension = fileNameExtract.split(".").pop();
    const path = imgPath.replace(fileNameExtract, "");
    const fileName = fileNameExtract.replace("." + fileExtension, ".webp").replace("%20", "_");
    const file = new File([blob], fileName, {type: 'image/webp'});
    await FilePicker.upload("data", path, file);
}

async function convertImgFile() {
    // Spawn application with quality slider and filepicker button
    const imgData = await new Promise((resolve) => {
        return new SSM_ConvertImage(resolve).render(true);
    })

    const tex = await loadTexture(imgData.imagePath);
    saveImgAsWebP(tex, imgData.imagePath, imgData.compression); // Don't need to await
}

async function convertImgsInFolder() {
    ui.notifications.info("Clicked convert images in folder button");
    const imgData = await new Promise((resolve) => {
        return new SSM_ConvertImage(resolve, true).render(true);
    })

    const image_extensions = [".bmp", ".gif", ".jpeg", ".jpg", ".png", ".tiff"];
    const images = await FilePicker.browse("data", imgData.imagePath, {extensions: image_extensions});
    for (const image of images.files) {
        const tex = await loadTexture(image);
        saveImgAsWebP(tex, image, imgData.compression);
    }
}

async function resizeImage() {

    const oldScene = canvas.scene || null;

    const imgData = await new Promise((resolve) => {
        return new SSM_ConvertImage(resolve, false, false, true).render(true);
    })
    const tex = await loadTexture(imgData.imagePath);

    const newSceneData = {
        height: Math.ceil(tex.height * 1.25),
        width: Math.ceil(tex.width * 1.25),
        name: "SSM Resize Image Temporary Scene",
        active: true,
        padding: 0
    }

    const scene = await Scene.create(newSceneData);

    //Create tile in new scene with image
    const newTileData = {
        height: tex.height,
        img: imgData.imagePath,
        tileSize: 100,
        type: "Tile",
        width: tex.width,
        x: 0,
        y: 0,
    }
    const cls = getDocumentClass("Tile");
    const tile = await cls.create(newTileData, {parent: scene})

    await wait(1000);

    canvas["tiles"].activate();

    await tile.object.control({releaseOthers: true});
    await canvas.pan({x: tile.width, y: tile.height, scale: 0.3});

    const result = await new Promise((resolve) => {
        //!!! User resizes tile as needed  !!!
        return new SSM_ResizeImage(resolve, tile).render(true);
    })

    canvas["tokens"].activate();

    if ( result ) {

        const sprite = new PIXI.Sprite(tex);
        const container = new PIXI.Container();
        container.addChild(sprite);
        container.width = tile.width;
        container.height = tile.height;

        const texture = PIXI.RenderTexture.create({
            width: tile.width,
            height: tile.height,
            scaleMode: PIXI.SCALE_MODES.LINEAR,
            resolution: 1
        })

        canvas.app.renderer.render(container, texture, undefined);

        const fileNameExtract = imgData.imagePath.split("/").pop();
        const fileExtension = fileNameExtract.split(".").pop();

        const d = canvas.dimensions;
        const widthSquares = Math.round(tile.width / d.size);
        const heightSquares = Math.round(tile.height/ d.size);

        const fileName = imgData.imagePath.replace("." + fileExtension, "_resized_" + widthSquares + "x" + heightSquares + "@" + d.size + "ppi.webp");
        saveImgAsWebP(texture, fileName, 0.88)
    }

    if ( oldScene !== null ) oldScene.update({active: true});
    scene.delete();
}

async function cropImage() {
    const oldScene = canvas.scene || null;

    const imgData = await new Promise((resolve) => {
        return new SSM_ConvertImage(resolve, false, false, true).render(true);
    })
    const tex = await loadTexture(imgData.imagePath);

    const newSceneData = {
        name: "SSM Crop Image Temporary Scene",
        active: true,
        padding: 0,
        img: imgData.imagePath
    }

    const scene = await Scene.create(newSceneData);

    await wait(50);

    if ( canvas["drawings"].active ) ui.controls.initialize({tool: "polygon"});
    else canvas["drawings"].activate({tool: "polygon"});
    
    //Cover area to keep with drawing shapes: circles, rectangles, polygons.  Each shape must overlap another.
    const result = await new Promise((resolve) => {
        return new SSM_CropImage(resolve).render(true);
    })

    if ( result ) {
        let firstPath = false;
        const unionPaths = new ClipperLib.Paths();
        for (const drawing of canvas.drawings.placeables) {
            let drawingPath = [];
            if ( drawing.document.shape.type === "r" ) {        // rectangle
                drawingPath = squareToPolygon(drawing.document);
                if ( game.modules.get('_dev-mode')?.api?.getPackageDebugValue(ModuleName) ) {
                    await displayPoints(drawingPath, 10);
                }
            }
            else if ( drawing.document.shape.type === "e" ) {   // ellipse
                drawingPath = ellipseToPolygon(
                    drawing.document.shape.width, 
                    drawing.document.shape.height,
                    30,
                    drawing.document.x,
                    drawing.document.y,
                    drawing.document.rotation
                );
                if ( game.modules.get('_dev-mode')?.api?.getPackageDebugValue(ModuleName) ) {
                    await displayPoints(drawingPath, 5);
                }

            }
            else if ( drawing.document.shape.type === "p" ) {   // polygon
                drawingPath = pointsToPolygon(drawing.document)
                if ( game.modules.get('_dev-mode')?.api?.getPackageDebugValue(ModuleName) ) {
                    await displayPoints(drawingPath, 10);
                }
            }
            else {
                if ( oldScene !== null ) oldScene.update({active: true});
                scene.delete();
                ui.notifications.info("This crop function doesn't support drawing shapes other than circles, rectangles or polygons.");       
                return false
            }

            if ( firstPath === false ) {
                firstPath = PolygonMesher.getClipperPathFromPoints(drawingPath);
            } else {
                unionPaths.push(PolygonMesher.getClipperPathFromPoints(drawingPath));
            }
        }

        const unionSolution = unionPaths.length ? clipperUnion(firstPath, unionPaths) : firstPath;
        if ( unionSolution === false ) {
            ui.notifications.warn(game.i18n.localize('SSM.Crop.notOverlapping'));
        } else {
            const polyPoints = flattenClipperPoints(unionSolution);
            const poly = new PIXI.Polygon(polyPoints);
            const bounds = poly.getBounds();

            const tempContainer = new PIXI.Container();
            const sprite = new PIXI.Sprite(tex);

            const mask = new PIXI.LegacyGraphics();
            mask.beginFill(0x000000);
            mask.drawPolygon(poly);
            mask.endFill();

            tempContainer.addChild(sprite);

            tempContainer.addChild(mask);
            tempContainer.mask = mask;

            const transform = PIXI.Matrix.IDENTITY.clone();
            transform.scale(1,1);
            const tx = bounds.x;
            const ty = bounds.y;
            transform.translate(-tx, -ty);

            const texture = PIXI.RenderTexture.create({
                width: bounds.width,
                height: bounds.height,
                scaleMode: PIXI.SCALE_MODES.LINEAR,
                resolution: 1
            });

            canvas.app.renderer.render(tempContainer, texture, undefined, transform);

            const fileNameExtract = imgData.imagePath.split("/").pop();
            const fileExtension = fileNameExtract.split(".").pop();

            const d = canvas.dimensions;
            const widthSquares = Math.round(bounds.width / d.size);
            const heightSquares = Math.round(bounds.height/ d.size);

            const fileName = imgData.imagePath.replace("." + fileExtension, "_CROPPED_" + widthSquares + "x" + heightSquares + "@" + d.size + "ppi.webp");
            saveImgAsWebP(texture, fileName, 0.88)
        }
    }
    
    if ( oldScene !== null ) oldScene.update({active: true});
    scene.delete();
    this.close();
}

function scaleScene() {
    ui.notifications.info("Clicked scale scene button");
    //TODO:  Ambitious!  Save all placeables coordinates and sizes as fractions of scene width and height.
    //After scene resizing, recalculate position and size of all placeables and update.
}

/** A function to move selected tiles by a vector, per button press.
 *  Debounces the final update by 3 seconds to not spam the server.
 *  @param {object}     vector      - An object vector to represent the translation, ex: {x: 100, y: -200}  ie:100 right, 200 up
 *  @returns {void}
 */
function nudge(vector) {
    const tiles = canvas.background.controlled;
    if (!tiles.length) return
    const updates = [];
    for (const tile of tiles) {
        tile.position.set(tile.position._x + vector.x, tile.position._y + vector.y);
        // Have to do the following so the tile doesn't jitter when clicking elsewhere in the scene.
        tile.data.x = tile.data._source.x += vector.x;
        tile.data.y = tile.data._source.y += vector.y;
        const updateObj = {
            _id: tile.id,
            x: tile.position._x,
            y: tile.position._y
        }
        updates.push(updateObj);
    }
    debouncedTileTranslation(updates);
}

/** Invokes the nudge function, and sets the vector to +1 in y direction (down) 
 *  @returns {void}
*/
function nudgeTileDOWN() {
    nudge({x: 0, y: 1});
}

/** Invokes the nudge function, and sets the vector to -1 in x direction (left) 
 *  @returns {void}
*/
function nudgeTileLEFT() {
    nudge({x: -1, y: 0});
}

/** Invokes the nudge function, and sets the vector to +1 in x direction (right) 
 *  @returns {void}
*/
function nudgeTileRIGHT() {
    nudge({x: 1, y: 0});
}

/** Invokes the nudge function, and sets the vector to -1 in y direction (up) 
 *  @returns {void}
*/
function nudgeTileUP() {
    nudge({x: 0, y: -1});
}

/** Insert data into source flags to be used the Scene Scroller module.*/
async function linkScenes() {
    if ( !game.modules.get("scene-scroller").active ) {
        ui.notifications.warn("This button requires the Scene Scroller module be activated.");
        return;
    }
    // Works by gathering information from selected tiles in the scene.
    const tiles = canvas.background.controlled;
    // Only allow 2 selected tiles at a time.
    if (tiles.length !== 2) {
        ui.notifications.warn("Two tiles must be selected.")
        return;
    }

    // Flag data required for each source scene.  So iterate once per tile
    for (const tile of tiles) {
        // The UUID for the selected tile will have been added as flag data by Scene Tiler
        const tileUUID = tile.document.getFlag("scene-tiler", "scene");
        // Obtain the UUID object, in this case a compendium scene
        const tileSource = await fromUuid(tileUUID);
        let sceneFlagData = game.modules.get("scene-tiler").schema.compendiumSceneFlags;
        const sceneFlagDataKeys = Object.keys(sceneFlagData);
        // First check to see if the source already has data stored in flags
        if (tileSource.data.flags.hasOwnProperty(ModuleName)) {
            sceneFlagData = tileSource.getFlag(ModuleName, sceneFlagDataKeys[0]);
        } 
        // Get a data object from the schema defined in the Scene Scroller class
        // This data goes into the LinkedTiles array that will be stored in the compendium scene flags.
        // When Scene Scroller creates a sub-scene, that data will then be attached to the Scene Tiler tile.
        const sceneTileLinks = game.modules.get("scene-tiler").schema.subSceneChildrenFlags;
        const childrenFlagKeys = Object.keys(sceneTileLinks);

        const tile1 = tile.id === tiles[0].id ? tiles[0] : tiles[1];
        const tile2 = tile.id === tiles[0].id ? tiles[1] : tiles[0];

        // Fill out the data that will be saved to the tile created by Scene Tiler.
        sceneTileLinks[childrenFlagKeys[0]] = tile2.document.getFlag("scene-tiler", "scene");
        sceneTileLinks[childrenFlagKeys[1]] = {x: tile1.data.x - tile2.data.x, y: tile1.data.y - tile2.data.y};

        // TO-DO:  Make sure not to duplicate links!
        sceneFlagData[sceneFlagDataKeys[0]].push(sceneTileLinks);

        // Commit the data to the compendium scene.
        await tileSource.setFlag(ModuleName, sceneFlagDataKeys[0], sceneFlagData[sceneFlagDataKeys[0]]);
    }
    ui.notifications.info("Links saved to scenes flags.")
}

/**
 * A confirmation dialog mostly used when debugging is turned on.
 * @param {string} title
 * @param {string} content
 * @returns {promise}
 */
export async function confirmDialog(title, content) {
    return await Dialog.confirm({
        title: title,
        content: content,
        yes: () => {return true},
        no: () => {return false}
    })
}

/**
 * 
 * @param {array} vertexCoords  // array of coordinate arrays, ie: [[x1, y1], [x2,y2], [x3, y3]...]
 * @returns {PIXI.Polygon}       
 */
export function generatePixiPolygon(vertexCoords) {
    let points = [];
    for (const pt of vertexCoords) {
        points = [...points, ...pt];
    }
    return new PIXI.Polygon(points);
}

/**
 * 
 * @param {array} a     array containing coordinate for a point on a line, ie: [x1, y1]
 * @param {array} b     array containing coordinate for other point on a line, ie: [x2, y2]
 * @returns {number}    The slope defined by the coordinates on a line
 */
export function slope(a, b) {
    return ( (a[1]-b[1]) / (a[0]-b[0]) )
}

/**
 * Function that calculates the coordinates for a new point that is a distance perpendicular to an
 * existing point on the line.
 * @param {number} slope    The slope of the line
 * @param {object} point    Object containing coordinates of a point, ie: {x: <number>, y: <number>}
 * @param {number} distance Distance of the new point from the existing line.
 * @returns {object}        {x: <number>, y: <number>}
 */
export function offsetPointFromSlope(slope, point, distance) {
    const perpSlope = 1 / slope * -1;
    const r = Math.sqrt(1 + perpSlope * perpSlope);     // Unit vector along perpSlope
    let offsetPoint = {
        x: point.x + (distance / r),
        y: point.y + ((distance * perpSlope) / r)
    }
    offsetPoint.x = (Math.floor(offsetPoint.x) === point.x) ? Math.ceil(offsetPoint.x) : Math.floor(offsetPoint.x);
    offsetPoint.y = (Math.floor(offsetPoint.y) === point.y) ? Math.ceil(offsetPoint.y) : Math.floor(offsetPoint.y);
    return {x: offsetPoint.x, y: offsetPoint.y}
}

 /**
 * Conversion from base64 image to blob found at:
 * https://stackoverflow.com/questions/38658654/how-to-convert-a-base64-string-into-a-file/38659875#38659875
 */
export function convertToBlob(image) {
       
    const pos = image.indexOf(';base64,');
    const b64 = image.substr(pos + 8);

    const imageContent = atob(b64);
    const buffer = new ArrayBuffer(imageContent.length);
    const view = new Uint8Array(buffer);

    for (let n=0; n < imageContent.length; n++) {
        view[n] = imageContent.charCodeAt(n);
    }

    return new Blob([buffer], {type: "image/webp"});
}

/**
 * Approximate a polygon from an ellipse defined by width and height assuming the width and height are aligned with the x and y axes.
 * This function attempts to increase the vertex density where the curvature changes rapidly (at the extremities of the major axis).
 * The generation of vertex points occurs over one quadrant and then symmetry is used to generate the rest of the points over the other quadrants.
 * 
 * @param {number} firstAxis    Either the minor or major ellipse axis in pixels
 * @param {number} secondAxis   The other axis in pixels
 * @param {number} points       How many points to generate per quadrant of the ellispe
 * @param {number} x            X pixel coordinate for the top left corner of the bounding box that encapsulates the ellipse
 * @param {number} y            Y pixel coordinate for the top left corner of the bounding box that encapsulates the ellipse
 * @param {number} rotation     The rotation of the drawing shape in Foundry, in degrees.
 */
function ellipseToPolygon(firstAxis, secondAxis, pointQty, sceneX, sceneY, rotation) {
    // For the following calculations, the major axis is assumed to be along the X axis
    const A = firstAxis > secondAxis ? (firstAxis / 2) : (secondAxis / 2);
    // The minor axis is assumed to be along the Y axis
    const B = firstAxis > secondAxis ? (secondAxis / 2) : (firstAxis / 2);

    /**
     * The points will be distributed along the top right quadrant so that the slope delta is equal between each point.
     * This should imply that the point density will be higher at the extremes of the major axis, creating a better fit than
     * equally distributed points over the perimeter.
     * 
     * The slope is the tangent on the perimeter of the ellipse at point <x, y>
     * At the extreme where Y = 0, the slope is vertical, which is infinity.  Need to generate a value for the slope near this point,
     * but finite in order to be able to distribute the points.
     * To do this, will choose a value for <x> near the extreme and then calculate <y>.  From these points, can calculate slope.
     */
    const pixelOffset = 2;  // Value chosen by trial and error

    // Equation of an ellipse: ( (x*x) / (a*a) ) + ( (y*y) / (b*b) ) = 1   when a is colinear with axis x
    // <x>, <a> & <b> are known.  Solve for <y>

    const X = A - pixelOffset;
    const Y = Math.round((B*Math.sqrt(A*A - X*X)) / A * 1000) / 1000;     // Two solutions, but only interested in positive Y result

    // Equation for slope at point <X, Y>: SLOPE = - (B*B*X) / (A*A*Y) when a is colinear with axis x
    const slopeAtExtreme = - Math.round((B*B*X) / (A*A*Y) * 1000) / 1000;
    
    /**
     * The slope at X = 0 is horizontal, which is equal to 0.
     * If we calculate a similar point offset by pixels, the value of the slope at the end of the ellipse minor axis would
     * be significantly smaller than the slope at the end of the ellipse major axis.  Therefore it can be ignored.
     * Thus if we divide slopeAtExtreme by the quantity of points we desire, we get the delta of the tangent slope between each point.
     */
    const deltaSlope = Math.round(slopeAtExtreme / pointQty * 1000) / 1000;

    // Begin to generate an array of points.  Start at major axis extreme on the positive X axis, and proceed counter-clockwise
    // Points are entered in sequence:  X1, Y1, X2, Y2, X3, Y3,..., Xn, Yn
    let pointsArray = [A, 0, X, Y]

    // Iterate over slope while slope is smaller than deltaSlope.
    // For each value of slope, calculate <x> & <y>
    let slope = slopeAtExtreme
    do {
        slope -= deltaSlope;
        const A2 = A*A;
        const B2 = B*B;
        const S2 = slope * slope;
        const x = Math.round(-A2*slope / Math.sqrt(A2*S2+B2) * 1000) / 1000;
        const y = Math.round(B/A * Math.sqrt(A2 - x*x) * 1000) / 1000;
        pointsArray.push(x, y);
    } while (slope < deltaSlope);

    pointsArray.push(0, B);

    // Now have pointQty points in the top right quadrant of the ellipse, plus a point at <y> = 0.
    // Due to symmetry, going to mirror the points across the minor axis / y axis.
    let tempArray = []
    for ( let i = pointsArray.length - 3; i > 0; i-=2) {
        tempArray.push(-pointsArray[i-1], pointsArray[i]);
    }
    pointsArray = [...pointsArray, ...tempArray];

    // Now have points in the two top quadrants of the ellipse.
    // Due to symmetry, mirror all points except those at <y> = 0 across the major axis / x axis.
    tempArray = [];
    for ( let i = pointsArray.length - 3; i > 2; i-=2) {
        tempArray.push(pointsArray[i-1], -pointsArray[i]);
    }
    pointsArray = [...pointsArray, ...tempArray];

    // If the firstAxis (width or height) entered was smaller than the second, then we need to rotate all the points 90 degrees
    // because we assumed the major axis was on the x axis to simplify the math.
    // Also add rotation angle of the document.
    let angleDeg = firstAxis < secondAxis ? 90 : 0;
    angleDeg = angleDeg + rotation > 360 ? angleDeg + rotation - 360 : angleDeg + rotation;
 
    if ( angleDeg !== 0 ) {
        for (let i = 0; i < pointsArray.length; i+= 2) {
            const tempPoint = rotatePoint(pointsArray[i], pointsArray[i+1], angleDeg);
            pointsArray[i] = tempPoint.x;
            pointsArray[i+1] = tempPoint.y
        }
    }

    // These coordinates are relative to the center of the ellipse (where major and minor axis coincide)
    // Need to translate the coordinates to be relative to the top left corner of the bounding box that encapsulates the ellipse
    // and then translate the top left corner to be positioned correctly on the canvas.
    for (let i = 0; i < pointsArray.length; i+= 2) {
        pointsArray[i] += (firstAxis / 2 + sceneX); 
        pointsArray[i+1] += (secondAxis / 2 + sceneY);
    }
    
    return pointsArray
}

function squareToPolygon(doc) {
    let pointsArray = [];
    // The rotation origin is centered across the width and height of the shape.  The coordinates need to be relative to this center
    // in order for rotations to calculate correctly
    const width = doc.shape.width;
    const height = doc.shape.height;
    pointsArray.push(
        0,
        0,
        width,
        0,
        width,
        height,
        0,
        height
    )

    if ( doc.rotation !== 0) {
        for (let i = 0; i < pointsArray.length; i+= 2) {
            const tempPoint = rotatePoint(pointsArray[i], pointsArray[i+1], doc.rotation, -width/2, -height/2);
            pointsArray[i] = tempPoint.x;
            pointsArray[i+1] = tempPoint.y
        }
    }

    // Translate the points to position them properly on the canvas
    for (let i = 0; i < pointsArray.length; i+= 2) {
        pointsArray[i] += doc.x; 
        pointsArray[i+1] += doc.y;
    }

    return pointsArray;
}

function pointsToPolygon(doc) {
    let evenOdd = true;
    let pointsArray = [];
    for (const p of doc.shape.points) {
        if ( evenOdd ) pointsArray.push(p)
        else pointsArray.push(p)
        evenOdd = !evenOdd
    }

    if ( doc.rotation !== 0) {
        const width = doc.shape.width;
        const height = doc.shape.height;
        for (let i = 0; i < pointsArray.length; i+= 2) {
            const tempPoint = rotatePoint(pointsArray[i], pointsArray[i+1], doc.rotation, -width/2, -height/2);
            pointsArray[i] = tempPoint.x;
            pointsArray[i+1] = tempPoint.y
        }
    }

    // Translate the points to position them properly on the canvas
    for (let i = 0; i < pointsArray.length; i+= 2) {
        pointsArray[i] += doc.x; 
        pointsArray[i+1] += doc.y;
    }

    return pointsArray;
}

/**
 * A function that rotates a set of points by an angle in degrees.
 * @param {number} x The <x> coordinate in pixels to be rotated
 * @param {number} y The <y> coordinate in pixels to be rotated
 * @param {number} rotation The rotation angle in degrees
 * @param {number} offsetX (optional) An offset value in pixels on the <x> axis in order to locate the rotation center
 * @param {number} offsetY (optional) An offset value in pixels on the <y> axis in order to locate the rotation center
 * @returns {object}    {x: <number>, y: <number>}
 */
function rotatePoint(x, y, rotation, offsetX = 0, offsetY = 0) {
    const angleRad = rotation * (Math.PI / 180);
    return {
        x: Math.round(((x + offsetX) * Math.cos(angleRad) - (y + offsetY) * Math.sin(angleRad)) * 1000) / 1000 - offsetX,
        y: Math.round(((y + offsetY) * Math.cos(angleRad) + (x + offsetX) * Math.sin(angleRad)) * 1000) / 1000 - offsetY
    }
}

async function displayPoints(points, size) {
    const container = new PIXI.Container();
    for ( let i = 0; i < points.length; i+=2) {
        const dot = new PIXI.LegacyGraphics();
        dot.beginFill("0xFF0000");
        dot.drawCircle(points[i], points[i+1], size);
        dot.endFill();
        container.addChild(dot);
    }

    canvas.stage.addChild(container);

    const title = "Ellipse vertices verification";
    const content = "Points should be on ellipse perimeter.";
    await confirmDialog(title, content);

    canvas.stage.removeChild(container);
    container.destroy(true);
}

export function clipperUnion(subjectPath, union_paths) {
    const union_cpr = new ClipperLib.Clipper();
    union_cpr.AddPath(subjectPath, ClipperLib.PolyType.ptSubject, true);
    union_cpr.AddPaths(union_paths, ClipperLib.PolyType.ptClip, true);

    const union_clipType = ClipperLib.ClipType.ctUnion;
    const union_fillType = ClipperLib.PolyFillType.pftNonZero;
    const solution = new ClipperLib.Paths();
    union_cpr.Execute(union_clipType, solution, union_fillType, union_fillType);

    if (solution.length > 1) return false;
    return solution[0];
}

export function flattenClipperPoints(arr) {
    let points = []
    for (const pt of arr) {
        points = [...points, pt.X, pt.Y];
    }
    return points
}