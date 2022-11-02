import { ModuleName, ModuleTitle } from "../ssm-launch.js";
import { SSM_ConvertImage, SSM_ResizeImage, SSM_CropImage, SSM_ConfirmationDialog } from "./forms.js";
import { SSM_SceneDivider } from "./scene-divider.js";
import { linkScenes } from "../dev/dev.js";

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
    const menuToggle = game.settings.get(ModuleName, "SSM_MenuToggle");
    if ( !menuToggle ) return;
    
    toolGroup.push({
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
                    onClick: checkForFlagData,
                    button: true
                }
            ]
        }) 

    /** Start of Development code.  Not released yet. */
    if ( canvas["tiles"]?.active ) {
        toolGroup.push({
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
        })
    }

    if ( game.modules.get("scene-scroller").active ) {
        toolGroup.push({
            name: game.i18n.localize('SSM.MenuButtons.CreateLinks.name'),
            title: game.i18n.localize('SSM.MenuButtons.CreateLinks.title'),
            icon: "<i class='fas fa-link'></i>",
            button: true,
            onClick: linkScenes
        })
    }
    /** End of Development code. */
}

async function checkForFlagData() {
    const hasFlagModuleName = canvas.scene.flags.hasOwnProperty(ModuleName);
    if ( !hasFlagModuleName ) return spawnDividerForm();
    const hasFlagDivData = canvas.scene.flags[ModuleName].hasOwnProperty("StoredDivs");
    if ( !hasFlagDivData ) return spawnDividerForm();

    const confirm = await new Promise((resolve) => {
        const title = game.i18n.localize("SSM.SceneDividerUI.LoadFlagsData");
        const content = game.i18n.localize("SSM.SceneDividerUI.LoadFlagsContent");
        return new SSM_ConfirmationDialog(title, content, resolve).render(true);
    })

    if ( !confirm ) return spawnDividerForm();

    return spawnDividerForm(confirm);
}

async function spawnDividerForm(useData = false) {
    if ( !useData ) new SSM_SceneDivider({height: "auto"}).render(true);
    else {
        const ssmSD = new SSM_SceneDivider({height: "auto"});
        await ssmSD.loadFlagData()
        ssmSD.render(true);
    }
}

async function convertBackground() {
    const background = canvas.scene.background?.src;
    const foreground = canvas.scene.foreground;
    let newPath = undefined;

    if ( background === undefined) {
        ui.notifications.warn(game.i18n.localize("SSM.ConvertBackground.noBackground"));
        return;
    } else {
        const fp = new FilePicker({type: "image"});
        let source, target;
        for (const img of [background, foreground]) {
            if ( img === null ) continue;
            [source, target] = fp._inferCurrentDirectory(img);
            const hasDefaultImgPath = await hasImgPath();
            if ( target === "" && !hasDefaultImgPath ) {
                ui.notifications.warn(game.i18n.localize("SSM.ConvertBackground.remoteAndNoDefault"));
                return;
            }

            if ( target === "" && hasDefaultImgPath ) {
                newPath = await convertImgFile(img, true);
            }

            if ( target !== "" ) newPath = await convertImgFile(img);

            if ( img === background ) await canvas.scene.update({background: {src: newPath}});
            if ( img === foreground ) await canvas.scene.update({foreground: newPath});
        }
    }
}

export async function saveImgAsWebP(fp, compression, fn = false, texture = false, force = false) {

    let tex;
    if ( !texture ) tex = await loadTexture(fp.request);
    else tex = texture;

    const image = canvas.app.renderer.extract.base64(new PIXI.Sprite(tex), "image/webp", compression);
    const blob = convertToBlob(image);

    if ( fn ) fp.request = fn;

    const path = fp.sources[fp.activeSource].target;

    const fileNameExtract = fp.request.split("/").pop();
    const fileExtension = fileNameExtract.split(".").pop();
    if ( fileExtension === "webp" && !force ) return undefined;


    // Save to disk
    const fileName = decodeURIComponent(fileNameExtract.replace("." + fileExtension, ".webp"));
    const file = new File([blob], fileName, {type: 'image/webp'});
    const bucket = fp.sources?.s3?.bucket;
    await FilePicker.upload(fp.activeSource, path, file, {bucket: bucket});
    if ( bucket !== undefined && fp.activeSource === "s3" ) return bucket + "/" + path + "/" + fileName;
    return path + "/" + fileName;
}

async function convertImgFile(path = null, useDefault = false) {
    // Spawn application with quality slider and filepicker button
    const imgData = await new Promise((resolve) => {
        return new SSM_ConvertImage(resolve, {path: decodeURIComponent(path), useDefault: useDefault}).render(true);
    })

    return await saveImgAsWebP(imgData.fp, imgData.compression); 
}

async function convertImgsInFolder() {
    const imgData = await new Promise((resolve) => {
        return new SSM_ConvertImage(resolve, {batch: true}).render(true);
    })

    const [source, target] = imgData.fp._inferCurrentDirectory(imgData.fp.request)
    let imgExt = Object.keys(CONST.IMAGE_FILE_EXTENSIONS);
    imgExt = imgExt.map(e => "." + e);
    const images = await FilePicker.browse(source, target, {extensions: imgExt});
    for (const image of images.files) {
        imgData.fp.request = image;
        await saveImgAsWebP(imgData.fp, imgData.compression);
    }
}

async function resizeImage(path = null) {

    const oldScene = canvas.scene || null;

    let imgData = {
        imagePath: path
    };

    if ( imgData.imagePath === null ) {
        imgData = await new Promise((resolve) => {
            return new SSM_ConvertImage(resolve).render(true);
        })
    } else {
        imgData.fp = new FilePicker({type: "image"});
        imgData.fp.request = imgData.imagePath;
        const [source, target] = imgData.fp._inferCurrentDirectory(imgData.imagePath);
        imgData.fp.activeSource = source;
        imgData.fp.sources[source].target = target;
    }

    const tex = await loadTexture(imgData.fp.request);

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
        img: imgData.fp.request,
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
    await canvas.pan({x: tile.width / 2, y: tile.height / 2, scale: 0.1});

    const result = await new Promise((resolve) => {
        //!!! User resizes tile as needed  !!!
        return new SSM_ResizeImage(resolve, tile, {}, {left: ui.sidebar._element[0].offsetParent.offsetLeft - 605, top: 3}).render(true);
    })

    canvas["tokens"].activate();

    let fileName = "";
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

        const fileNameExtract = imgData.fp.request.split("/").pop();
        const fileExtension = fileNameExtract.split(".").pop();

        const d = canvas.dimensions;
        const widthSquares = Math.round(tile.width / d.size);
        const heightSquares = Math.round(tile.height/ d.size);

        fileName = imgData.fp.sources[imgData.fp.activeSource].target + "/" + fileNameExtract.replace("." + fileExtension, "_RESIZED_" + widthSquares + "x" + heightSquares + "@" + d.size + "ppi." + fileExtension);
        fileName = await saveImgAsWebP(imgData.fp, imgData.compression, fileName, texture)
    }

    if ( oldScene !== null ) await oldScene.update({active: true});
    await wait(1000);
    await scene.delete();
    return fileName;
}

async function cropImage() {
    const oldScene = canvas.scene || null;

    const imgData = await new Promise((resolve) => {
        return new SSM_ConvertImage(resolve).render(true);
    })
    const tex = await loadTexture(imgData.fp.request);

    const newSceneData = {
        name: "SSM Crop Image Temporary Scene",
        active: true,
        padding: 0,
        img: imgData.fp.request
    }

    const scene = await Scene.create(newSceneData);

    await wait(500);

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
                    100,
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

            const fileNameExtract = imgData.fp.request.split("/").pop();
            const fileExtension = fileNameExtract.split(".").pop();

            const d = canvas.dimensions;
            const widthSquares = Math.round(bounds.width / d.size);
            const heightSquares = Math.round(bounds.height/ d.size);

            const fileName = imgData.fp.sources[imgData.fp.activeSource].target + "/" + fileNameExtract.replace("." + fileExtension, "_CROPPED_" + widthSquares + "x" + heightSquares + "@" + d.size + "ppi." + fileExtension);
            saveImgAsWebP(imgData.fp, imgData.compression, fileName, texture)
        }
    }
    
    if ( oldScene !== null ) await oldScene.update({active: true});
    await wait(1000);
    await scene.delete();
}

async function scaleScene() {
    const originalScene = canvas.scene || null;

    if ( originalScene === null ) {
        ui.notifications.warn(game.i18n.localize("SSM.ScaleScene.noScene"));
        return;
    }

    const path = await resizeImage(canvas.scene.background.src);
    const tex = await loadTexture(path);
    const data = originalScene.toObject();

    // Update data with the info for the to-be-created scaled scene
    data.name += "_SCALED";
    data.background.src = path;
    data["-=_id"] = null;
    data.width = tex.width;
    data.height = tex.height;
    data.foreground = canvas.scene.foreground;

    const newScene = await Scene.create(data);
    await wait(1000);
    newScene.dimensions = newScene.getDimensions();

    const copyPlaceables = (placeable) => {
        
        const od = originalScene.dimensions;
        const nd = newScene.dimensions;
        const scale = (nd.sceneWidth / od.sceneWidth) > (nd.sceneHeight / od.sceneHeight) ?
                            nd.sceneHeight / od.sceneHeight : 
                            nd.sceneWidth / od.sceneWidth;
        const updateArray = [];
        for (const p of originalScene[placeable].toObject()){

            switch (placeable) {
                case "walls" : 
                    p.c[0] = Math.round(((p.c[0] - od.sceneX) / od.sceneWidth * nd.sceneWidth) + nd.sceneX);
                    p.c[1] = Math.round(((p.c[1] - od.sceneY) / od.sceneHeight * nd.sceneHeight) + nd.sceneY);
                    p.c[2] = Math.round(((p.c[2] - od.sceneX) / od.sceneWidth * nd.sceneWidth) + nd.sceneX);
                    p.c[3] = Math.round(((p.c[3] - od.sceneY) / od.sceneHeight * nd.sceneHeight) + nd.sceneY);
                    break;
                case "lights" :
                    p.config.bright *= scale;
                    p.config.dim *= scale;
                    break;
                case "sounds" :
                    p.radius *= scale;
                    break;
                case "tiles" : 
                    p.width *= (nd.sceneWidth / od.sceneWidth);
                    p.height *= (nd.sceneHeight / od.sceneHeight);
                    break;
                case "templates" : 
                    p.distance *= scale;
                    break;
            }

            if ( placeable !== "walls" ) {
                p.x = Math.round(((p.x - od.sceneX) / od.sceneWidth * nd.sceneWidth) + nd.sceneX);
                p.y = Math.round(((p.y - od.sceneY) / od.sceneHeight * nd.sceneHeight) + nd.sceneY); 
            }

            updateArray.push(p)
        }

        return updateArray;
    }

    await newScene.update({
        walls: copyPlaceables("walls"),
        drawings: copyPlaceables("drawings"),
        lights: copyPlaceables("lights"),
        notes: copyPlaceables("notes"),
        sounds: copyPlaceables("sounds"),
        templates: copyPlaceables("templates"),
        tiles: copyPlaceables("tiles"),
        tokens: copyPlaceables("tokens")
    })
}

 /**
 * Conversion from base64 image to blob found at:
 * https://stackoverflow.com/questions/38658654/how-to-convert-a-base64-string-into-a-file/38659875#38659875
 */
function convertToBlob(image) {
       
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

    // By trial and error, it was found that establishing points at equal slope delta packs too many points at high curvature peaks
    // Going to add a check in the loop to eliminate points that aren't distant enough from the preceding point.
    const minGap = canvas.dimensions.size / 5;
    // Iterate over slope while slope is smaller than deltaSlope.
    // For each value of slope, calculate <x> & <y>
    let slope = slopeAtExtreme;
    do {
        slope -= deltaSlope;
        const A2 = A*A;
        const B2 = B*B;
        const S2 = slope * slope;
        const x = Math.round(-A2*slope / Math.sqrt(A2*S2+B2) * 1000) / 1000;
        const y = Math.round(B/A * Math.sqrt(A2 - x*x) * 1000) / 1000;
        const i = pointsArray.length - 2;
        const x1 = pointsArray[i];
        const y1 = pointsArray[i+1];
        const dist = Math.sqrt((x - x1)*(x - x1) + (y - y1)*(y - y1));
        if ( dist > minGap ) pointsArray.push(x, y);
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

function clipperUnion(subjectPath, union_paths) {
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
    const path = Array.isArray(arr[0]) ? arr[0] : arr;
    let points = []
    for (const pt of path) {
        points = [...points, pt.X, pt.Y];
    }
    return points
}

export function unionPolygons(subjectPath, clipPaths, collinear = false) {

    let subject = JSON.parse(JSON.stringify(subjectPath)); 
    subject = Array.isArray(subject[0]) ? subject[0] : subject;
    // In case this is the first time this is being called
    if ( subjectPath === undefined && clipPaths.length < 2) {
        return Array.isArray(clipPaths[0]) ? clipPaths[0] : clipPaths;
    } else if ( subjectPath === undefined ) {
        subject = clipPaths.shift();
    }

    // Union all extra polygons that were recorded.
    if ( clipPaths.length ) {
        
        const union_cpr = new ClipperLib.Clipper();
        if ( collinear ) union_cpr.PreserveCollinear = true;
        union_cpr.AddPath(subject, ClipperLib.PolyType.ptSubject, true);
        union_cpr.AddPaths(clipPaths, ClipperLib.PolyType.ptClip, true);

        const union_clipType = ClipperLib.ClipType.ctUnion;
        const union_fillType = ClipperLib.PolyFillType.pftNonZero;
        union_cpr.Execute(union_clipType, subject, union_fillType, union_fillType);
    }

    return subject;
}

export function isColliding(subject, test) {
    const path1 = Array.isArray(subject[0]) ? subject[0] : subject;
    const path2 = Array.isArray(test[0]) ? test[0] : test;
    let minkDiff =  ClipperLib.Clipper.MinkowskiDiff(path1, path2);
    minkDiff = Array.isArray(minkDiff[0]) ? minkDiff[0] : minkDiff;
    return ClipperLib.Clipper.PointInPolygon({X: 0, Y: 0}, minkDiff);
}

export async function hasImgPath() {
    const defaultPath = game.settings.get(ModuleName, "defaultImagePath");
    if ( defaultPath === "" ) return false;

    try {
        await FilePicker.browse("data", defaultPath);
    } catch {
        return false
    }

    return true;
}

/**
 * Creates a ClipperLib Path that contains the scene minus <inwardOffset> pixel(s) in each direction.
 * @returns {array}     A Clipper Lib formatted array.
 */
export function getSceneBoundsAsClipper(inwardOffset = 0) {
    const d = canvas.dimensions;
    const sceneBounds = new ClipperLib.Path();
    sceneBounds.push(
        new ClipperLib.IntPoint(d.sceneX + inwardOffset, d.sceneY + inwardOffset),
        new ClipperLib.IntPoint(d.sceneX + d.sceneWidth - inwardOffset, d.sceneY + inwardOffset),
        new ClipperLib.IntPoint(d.sceneX + d.sceneWidth - inwardOffset, d.sceneY + d.sceneHeight - inwardOffset),
        new ClipperLib.IntPoint(d.sceneX + inwardOffset, d.sceneY + d.sceneHeight - inwardOffset),
    )
    return sceneBounds;
}

export function getCompendiumPack(name) {
    const packName = name.toLowerCase().replace(/ /g, "-");
    const pack = game.packs.get(`world.${packName}`);
    return pack
}

/**
 * 
 * @param {object}          options                 Options to define where images are saved and where scenes are created.
 *                                                  Images will default to compendium settings, which must be set if argument is not provided.
 *                                                  Scenes will be created in Foundry core scene folder, unless compendium argument(s) are provided.
 * @param {string|boolean}  options.imgPath         Optional: File path to desired image storage location
 * @param {boolean}         options.newCompendium   Optional: TRUE to create a new compendium.  Defaults to FALSE.
 * @param {string|boolean}  options.compendiumName  Optional: Name of a new or existing compendium.  Defaults to FALSE.  
 * @returns {void}
 */
export async function processFlaggedDivisionData({imgPath = false, newCompendium = false, compendiumName= false} = {}) {
    if ( !canvas.scene.getFlag(ModuleName, "StoredDivs") ) {
        ui.notifications.error(game.i18n.localize("SSM.SceneDividerUI.NoFlagDataErr"));
        return;
    }
    const ssmSD = new SSM_SceneDivider();
    await ssmSD.loadFlagData();
    await ssmSD.divideScene({imgPath: imgPath, newCompendium : newCompendium, compendiumName : compendiumName});
}