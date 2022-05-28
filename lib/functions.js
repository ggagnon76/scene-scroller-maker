import { ModuleName, ModuleTitle } from "../ssm-launch.js";
import { SSM_SceneDivider, SSM_ConvertImage, SSM_ResizeImage } from "./forms.js";

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
            console.log(ModuleTitle,  " debugging | ", ...content);
        } else if ( force ) {
            console.log(ModuleTitle, " | ", ...content)
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
    },
    {
        name: game.i18n.localize('SSM.MenuButtons.CreateLinks.name'),
        title: game.i18n.localize('SSM.MenuButtons.CreateLinks.title'),
        icon: "<i class='fas fa-link'></i>",
        button: true,
        onClick: linkScenes
    })
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
    const fileName = fileNameExtract.replace("." + fileExtension, ".webp");
    const path = imgPath.replace(fileNameExtract, "");
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
        return new SSM_ConvertImage(resolve, false, false).render(true);
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
    if ( ui.controls.activeControl !== "tiles") {
        ui.controls.activeControl = "tiles";
        canvas["background"].activate();
    }
    await tile.object.control({releaseOthers: true});
    await canvas.pan({x: tile.data.width, y: tile.data.height, scale: 0.3});

    await new Promise((resolve) => {
        //!!! User resizes tile as needed  !!!
        //(Maybe provide tool to measure x by x squares?)
        return new SSM_ResizeImage(resolve, tile).render(true);
    })

    ui.controls.activeControl = "tokens";
        canvas["tokens"].activate();

    // Just in case user resized scene and added padding.
    const transform = PIXI.Matrix.IDENTITY.clone();
    transform.scale(1,1);
    const tx = tile.data.x;
    const ty = tile.data.y;
    transform.translate(-tx, -ty)

    const texture = PIXI.RenderTexture.create({
        width: tile.data.width,
        height: tile.data.height,
        scaleMode: PIXI.SCALE_MODES.LINEAR,
        resolution: 1
    })

    canvas.app.renderer.render(canvas.background, texture, undefined, transform);

    const fileNameExtract = imgData.imagePath.split("/").pop();
    const fileExtension = fileNameExtract.split(".").pop();
    const fileName = imgData.imagePath.replace("." + fileExtension, "_resized.webp")
    saveImgAsWebP(texture, fileName, 1)
    if ( oldScene !== null ) oldScene.update({active: true});
    scene.delete();
}

function cropImage() {
    ui.notifications.info("Clicked crop image button");
    //TODO: Use walls to enclose area to crop.  Can be polygon
    //Use Texture2Polygon class methods to generate the cropped image
    //Save to disk
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
    // Works by gathering information from selected tiles in the scene.
    const tiles = canvas.background.controlled;
    // Only allow 2 selected tiles at a time.
    if (tiles.length !== 2) {
        ui.notifications.error("Two tiles must be selected.")
        return;
    }

    // Flag data required for each source scene.  So iterate once per tile
    for (const tile of tiles) {
        // The UUID for the selected tile will have been added as flag data by Scene Tiler
        const tileUUID = tile.document.getFlag("scene-tiler", "scene");
        // Obtain the UUID object, in this case a compendium scene
        const tileSource = await fromUuid(tileUUID);
        let sceneFlagData = {};
        // First check to see if the source already has data stored in flags
        if (tileSource.data.flags.hasOwnProperty(ModuleName)) {
            sceneFlagData = tileSource.getFlag(ModuleName, "sceneScrollerTilerFlags");
        } 
        // if not, grab a data object from the schema defined in the Scene Scroller class.
        // This data goes into the compendium scene flags.
        else {
            sceneFlagData = foundry.utils.deepClone(game.modules.get("scene-scroller").api.sceneScrollerTilerFlags);
        }
        // Get a data object from the schema defined in the Scene Scroller class
        // This data goes into the LinkedTiles array that will be stored in the compendium scene flags.
        // When Scene Scroller creates a sub-scene, that data will then be attached to the Scene Tiler tile.
        const sceneTileLinks = foundry.utils.deepClone(game.modules.get("scene-scroller").api.sceneScrollerTileLinks);

        const tile1 = tile.id === tiles[0].id ? tiles[0] : tiles[1];
        const tile2 = tile.id === tiles[0].id ? tiles[1] : tiles[0];

        // Fill out the data that will be saved to the tile created by Scene Tiler.
        sceneTileLinks.SceneUUID = tile2.document.getFlag("scene-tiler", "scene");
        sceneTileLinks.Vector = {x: tile1.data.x - tile2.data.x, y: tile1.data.y - tile2.data.y};

        // Check to see if the compendium scene already has this data?
        const isExists = sceneFlagData.LinkedTiles.filter(d => d.SceneUUID === tileUUID);
        // If the compendium scene DOES have this data in the array, replace it?
        // TO-DO:  I DON'T THINK THIS IS WORKING... NEEDS TESTING.
        if (isExists.length) {
            const index = sceneFlagData.LinkedTiles.indexOf(isExists[0]);
            if (index !== -1) {
                sceneFlagData.LinkedTiles[index] = sceneTileLinks;
            }
        } 
        // If it doesn't have the data already, then add it to the array.
        else sceneFlagData.LinkedTiles.push(sceneTileLinks)

        // Commit the data to the compendium scene.
        await tileSource.setFlag(ModuleName, "sceneScrollerTilerFlags", sceneFlagData);
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
    return {
        x: point.x + (distance / r),
        y: point.y + ((distance * perpSlope) / r)
    }
}

/**
 * Calculates the intersection point between two lines, given two slopes and a point on each slope.
 * Function is used to offset the first line (thisSlope, origCoord) so it passes through a new point (thisPoint).
 * Returns the intersection of the two lines after the first line has been offset.
 * @param {object} origCoord    {x: <number>, y: <number>}
 * @param {number} thisSlope    Slope of one of two lines
 * @param {object} thisPoint    {x: <number>, y: <number>}
 * @param {number} otherSlope   Slope of second of two lines
 * @param {object} otherPoint   {x: <number>, y: <number>}
 * @returns {object}            {x: <number>, y: <number>}
 */
export function newIntersectPoint(origCoord, thisSlope, thisPoint, otherSlope, otherPoint) {

    const this_b = thisPoint.y - (thisSlope * thisPoint.x);         // b = y - mx
    const other_b = otherPoint.y - (otherSlope * otherPoint.x);     // b = y - mx 

    if ( thisSlope === 0 ) {
        // Horizontal, therefore Y is known.
        if ( !isFinite(otherSlope) || otherSlope === 0 ) return {x: origCoord.x, y: thisPoint.y}
        let new_x = (thisPoint.y - other_b) / otherSlope; // x = (y-b)/m
        new_x = Math.floor(new_x) === origCoord.x ? Math.ceil(new_x) : Math.floor(new_x);
        return {x: new_x, y: thisPoint.y}
    } else if ( isFinite(thisSlope) ) {
        // Angle
        let new_x, new_y;
        if ( otherSlope === 0) {    // Horizontal, y is known
            new_x = (origCoord.y - this_b) / thisSlope;    // x = (y-b)/m
            new_y = origCoord.y;
        } else  if ( isFinite(otherSlope) ) {  // Angle
            new_x = (-this_b - other_b) / (otherSlope - thisSlope); // x = (-b - b2) / (m2 / m);
            new_y = thisSlope * new_x + this_b;                     // y = mx + b
        } else {    // Vertical, x is known
            new_x = origCoord.x;
            new_y = thisSlope * new_x + this_b;         // y = mx + b    
            new_y = Math.floor(new_y) === origCoord.y ? Math.ceil(new_y) : Math.floor(new_y);
        } 
        return {x: new_x, y: new_y}
    } else {
        // Vertical, therefore X is known.
        if ( otherSlope === 0 || !isFinite(otherSlope) ) return {x: thisPoint.x, y: origCoord.y}
        let new_y = otherSlope * thisPoint.x + other_b;   // y = mx + b
        new_y = Math.floor(new_y) === origCoord.y ? Math.ceil(new_y) : Math.floor(new_y);
        return {x: thisPoint.x, y: new_y}
    }
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