import { ModuleName } from "../ssm-launch.js";
import { Texture2Polygon } from "./poly_from_texture.js";
import {    log,
            confirmDialog, 
            slope,
            offsetPointFromSlope,
            convertToBlob,
            unionPolygons,
            isColliding,
            getUUID,
            getCompendiumPack} from "./functions.js";

export const polygonOffsetByPixels = 2;

export class SSM_SceneDivider extends FormApplication {
    constructor() {
        super();

        this.hasImgPath = false;            // boolean for handlebars template
        this.hasCompName = false;           // boolean for handlebars template
        this.path = "";                     // path to directory to save images
        this.compName = "";                 // Name of new compendium
        this.hasDivisions = false;          // boolean for handlebars template
        this.divisions = [];                // Array of Texture2Polygon instances
        this.isDividing = false;            // boolean for handlebars template
        this.isExplored = false;            // boolean for handlebars template
        this.hasInWorkDivision = true;      // boolean for handlebars template
        this.inWorkDivTitle = "";           // Name of sub-scene.  Also becomes the filename for the image.
        this.vision = undefined;            // Object containing vision data when defining sub-scene area
        this.refreshTime = undefined;       // Used in throttle function => used in refreshVision method
        this.polygonPaths = new Set();      // Set of polygon paths extracted from clockwiseSweepPolygon (see refreshVision())
        this.linkContainer = undefined;     // A reference to be able to remove the link graphics added to the scene
        this.links = new Map();             // To verify we don't create more than one link per pair of divisions
        this.linkContainer = new PIXI.Container();
        this.eventHandlersSwapped = false   // Boolean to keep track of when event handlers have been replaced with Scene Scroller Maker functions.
        // Needed to fool core foundry into making this class instance work where a Token instance usually goes (for VisionSource)
        this.document = {
            detectionModes: [
                {
                    id: 'basicSight',
                    enabled: true,
                    range: Infinity
                }
            ]
        };
        this.getLightRadius = (units) => {
            // similar to foundry.js, line 46158
            if (units === 0) return 0;
            const u = Math.abs(units);
            return (((u / canvas.dimensions.distance) * canvas.dimensions.size) + 50) * Math.sign(units);
        }

        // Needed to hold the core foundry event handlers because they will be temporarily replaced
        this.longPressHolder = canvas.mouseInteractionManager.callbacks.longPress;
        this.clickLeftHolder = canvas.mouseInteractionManager.callbacks.clickLeft;
        this.dragLeftStartHolder = canvas.mouseInteractionManager.callbacks.dragLeftStart;
        this.dragLeftMoveHolder = canvas.mouseInteractionManager.callbacks.dragLeftMove;
        this.dragLeftDropHolder = canvas.mouseInteractionManager.callbacks.dragLeftDrop;

        this.convertWalls();                // Blocks vision for windows, open doors, etc..
        this.setTokenLayer();               // When the application is launched, resets the ui to Token Layer

        // Create a clipper path defined by the scene boundary.
        this.sceneBounds = this.getSceneBounds();

        // To draw the graphics for the links on the canvas.
        canvas.stage.addChild(this.linkContainer);
    }

    static get defaultOptions() {
        return mergeObject(super.defaultOptions, {
            width: 500,
            template: `./modules/${ModuleName}/templates/ssm-scene-divider.hbs`,
            id: "ssm-scene-divider",
            title: game.i18n.localize('SSM.SceneDividerUI.Title'),
            submitOnChange: false,
            closeOnSubmit: false
        })
    }

    // Adds the close function when the dialog is closed via ESC key.
    _onKeyDown(event) {
        // Close dialog
        if ( event.key === "Escape" ) {
            event.preventDefault();
            event.stopPropagation();
            return this.close();
        }
    }

    getData() {

        // Gather data here.
        const returnObj = {
            hasPath: this.hasImgPath,
            path: this.path,
            hasCompName: this.hasCompName,
            hasDivisions: this.hasDivisions,
            hasInWorkDivision: this.hasInWorkDivision,
            inWorkDivision: this.inWorkDivision,
            divisions: this.divisions,
            inWorkDivTitle: this.inWorkDivTitle,
            isDividing: this.isDividing,
            isExplored: this.isExplored,
            compName: this.compName
        }

        return returnObj
    }

    activateListeners(html) {
        super.activateListeners(html);

        html.find("#comp-continue").click(this._compContinue.bind(this));
        html.find("#div-continue").click(this._divContinue.bind(this));
        html.find("#create-div").click(this._createDiv.bind(this));
        html.find("#dvdg-continue").click(this._launchT2P.bind(this));
        html.find(".division-trash").click(this._deleteDivision.bind(this));
        document.addEventListener("keydown", this._onKeyDown.bind(this));
    }

    // Logic when form is submitted.
    async _updateObject(event, formData) {
        // Create the compendium if it doesn't already exist
        const confirm = await this.createCompendium();
        if ( !confirm ) return;
        const pack = getCompendiumPack(this.compName);
        if ( pack === undefined ) {
            ui.notifications.warn("Unable to proceed.  See logs.")
            log(true, "Unable to find pack.  See getCompendiumPack() function.");
            this.close();
            return;
        }
        // Create all of the scene backgrounds and save at selected location
        for (const division of this.divisions) {
            await this.saveSubSceneTextureToFile(division);
        }
        await this.restoreWalls();
        await this.deletePolyDrawings();
        // Create all of the scenes and save them in the compendium
        await this.addSubScenesToCompendium(pack);
        // Embed the placeables in the scene that are found in each sub-scene.
        await this.cullPlaceablesInPack(pack);
        // Embed links into the sub-scenes.
        await this.embedLinkFlags(pack);

        this.close();
    }

    /**
     * Creates a ClipperLib Path that contains the scene minus 1 pixel in each direction.
     * Used to prevent the creation of a vision source in the padding area.
     * @returns {array}     A Clipper Lib formatted array.
     */
    getSceneBounds() {
        const d = canvas.dimensions;
        const sceneBounds = new ClipperLib.Path();
        sceneBounds.push(
            new ClipperLib.IntPoint(d.sceneX + 1, d.sceneY + 1),
            new ClipperLib.IntPoint(d.sceneX + d.sceneWidth - 1, d.sceneY + 1),
            new ClipperLib.IntPoint(d.sceneX + d.sceneWidth - 1, d.sceneY + d.sceneHeight - 1),
            new ClipperLib.IntPoint(d.sceneX + 1, d.sceneY + d.sceneHeight - 1),
        )
        return sceneBounds;
    }

    /**
     * Deletes the drawing polygons that visually represent the areas
     * defined by each sub-scene.
     */
    async deletePolyDrawings() {
        if ( !this.divisions.length ) return;
        const drwIDS = [];
        for (const div of this.divisions) {
            if ( div.drawingID !== "" && div.drawingID !== undefined) {
                if ( canvas.scene.drawings.has(div.drawingID) ) drwIDS.push(div.drawingID);
            }
        }

        if ( drwIDS.length ) await canvas.scene.deleteEmbeddedDocuments("Drawing", drwIDS);
    }

    /**
     * Override the close method to reset the scene the way it was.
     * @param {object} options Foundry options
     */
    async close(options={}) {

        await this.deletePolyDrawings();
        
        this.endSight();
        this._resetHandlers();

        this.restoreWalls();
        canvas.stage.removeChild(this.linkContainer);
        this.linkContainer.destroy(true);

        return super.close(options);
    }

    /**
     * Sets the UI to the Token Layer
     */
    setTokenLayer() {
        if ( canvas["tokens"].active) ui.controls.initialize({tool: "token"});
        else canvas["tokens"].activate({tool: "token"});
    }

    /**
     * Deletes and resets any existing fog exploration.
     */
    async resetFog() {
        canvas.fog._handleReset();
    }

    /**
     * In-memory only update to walls in order to make windows, open doors, etc... block vision.
     */
    async convertWalls() {
        const seeThruWalls = canvas.walls.placeables.filter(w => w.document.sight === 0);
        for (const wall of seeThruWalls) {
            await wall.document.update({  // In memory update only
                flags: {
                    [ModuleName] : {
                        sight: wall.document.sight
                    }
                },
                sight: 20
            })
        }
        const openDoors = canvas.walls.placeables.filter(d => d.document.ds === 1);
        for (const door of openDoors) {
            await door.document.update({ // In memory update only
                flags: {
                    [ModuleName] : {
                        ds: door.document.ds
                    }
                },
                ds: 0
            })
        }
    }

    /**
     * Reverses changes made by the convertWall method.
     */
    async restoreWalls() {
        const seeThruWalls = canvas.walls.placeables.filter(w => w.document.flags.hasOwnProperty(ModuleName));
        for (const wall of seeThruWalls) {
            if ( wall.document.flags[ModuleName].hasOwnProperty("sight") ) {
                await wall.document.update({
                    sight: wall.document.flags[ModuleName].sight
                });
            } else await wall.document.update({
                ds: wall.document.flags[ModuleName].ds
            });
        }
    }

    /**
     * Creates an instance of the Texture2Polygon class.
     * Refreshes the application form.
     */
    async _launchT2P() {

        // Create instance containing all necessary sub-scene data
        const T2P = new Texture2Polygon(this);
        const confirm = await T2P.generateDrawingPolygon();

        this._resetHandlers();

        // if instance successfully generated a polygon and other info
        if ( confirm ) {
            this.divisions.push(T2P);
            this.hasDivisions = true;
            if ( this.divisions.length > 1 ) {
                this.createLinks(T2P);
            }
        }
        
        // Reset various booleans and data
        this.hasInWorkDivision = false;
        this.isDividing = false;
        this.isExplored = false;
        this.inWorkDivTitle = "";
        this.polygonPaths = new Set();
        // Rerender application 
        this.render(false, {width: 500, height: "auto"});
    }

    /**
     * Logic applied when user clicks button to create a new division.
     * Refreshes the application form.
     */
    _createDiv() {
        this.hasInWorkDivision = true;
        this.render(false, {height: "auto"})
    }

    /**
     * Logic applied when user clicks the continue button after entering a compendium name.
     * Refreshes the application form.
     */
    _compContinue() {
        const isText = document.getElementById("comp-input").value;
        if ( isText === "" ) {
            ui.notifications.info(game.i18n.localize('SSM.SceneDividerUI.ErrorNoCompName'))
            return;
        }
        this.compName = isText;
        this.hasCompName = true;
        this.render(false, {height: "auto"});
    }

    /**
     * Logic applied when user clicks the continue button after entering a sub-scene name.
     * Refreshes the application form.
     */
    _divContinue() {
        this.resetFog();

        // If the user didn't enter any text for the name field
        const isText = document.getElementById("div-input").value;
        if ( isText === "" ) {
            ui.notifications.info(game.i18n.localize('SSM.SceneDividerUI.ErrorNoSubSceneName'));
            return;
        }

        this.inWorkDivTitle = isText;
        this.isDividing = true;

        // Start replacing event handlers so the user can paint the areas representing the new div
        this.eventHandlersSwapped = true;

        // Disable the long-press causing map ping while the user is 'painting' the div.
        canvas.mouseInteractionManager.callbacks.longPress = () => {};

        // Replace the click-left event handler to instead create a VisionSource and update perception.
        const ssmClickLeft = (event) => {

            const cursorLoc = {x: event.data.origin.x, y: event.data.origin.y};
            this.refreshVision(cursorLoc);

        }
        canvas.mouseInteractionManager.callbacks.clickLeft = ssmClickLeft;

        // Replace the drag-left-start handler so it does nothing to the canvas, but does update the application to display the continue button.
        const ssmDragLeftStart = () => {
            
            this.isExplored = true;
            this.render(false, {width: 300, height: "auto"});

        };
        canvas.mouseInteractionManager.callbacks.dragLeftStart = ssmDragLeftStart;

        // Replace the drag left move handler to do 3 things:
        // 1) prevent this handler from trying to update the perception too often, ie: throttle
        // 2) prevent updates to the vision source when the cursor is outside of the scene (into the padding)
        // 3) update the perception to 'paint' the area visible from the moving mouse cursor.
        const ssmHandleDragMove = (event) => {

            // Only update the vision every 50ms
            if ( this.throttle() ) return;
            // Ignore any update attempts that are in the padding
            const cursorLoc = {x: event.data.destination.x, y: event.data.destination.y};
            const pt1 = new ClipperLib.IntPoint(cursorLoc.x, cursorLoc.y);
            if ( ClipperLib.Clipper.PointInPolygon(pt1, this.sceneBounds) === 0 ) return;
            // Update the vision source
            this.refreshVision(cursorLoc);

        };
        canvas.mouseInteractionManager.callbacks.dragLeftMove = ssmHandleDragMove;

        // Replace the drag-left-drop handler to remove the vision source
        const ssmHandleDragDrop = (event) => {

            this.endSight();
        };
        canvas.mouseInteractionManager.callbacks.dragLeftDrop = ssmHandleDragDrop;

        this.render(false, {width: 300, height: "auto"});
    }

    /**
     * A convenience function to reset all the event handlers that were modified by _divContinue();
     */
    _resetHandlers() {
        if ( !this.eventHandlersSwapped ) return;
        canvas.mouseInteractionManager.callbacks.longPress = this.longPressHolder;
        canvas.mouseInteractionManager.callbacks.clickLeft = this.clickLeftHolder;
        canvas.mouseInteractionManager.callbacks.dragLeftStart = this.dragLeftStartHolder;
        canvas.mouseInteractionManager.callbacks.dragLeftMove = this.dragLeftMoveHolder;
        canvas.mouseInteractionManager.callbacks.dragLeftDrop = this.dragLeftDropHolder;
        this.eventHandlersSwapped = false;
    }

    /**
     * Logic applied when the user selects the trash icon to delete a division.
     * Refreshes the application form.
     */
    _deleteDivision(event) {
        const li = event.currentTarget.closest(".ssm-div-card");
        const divID = li.dataset.divisionId;
        const divisionIndex = this.divisions.findIndex(d => d.drawingID === divID);
        this.divisions.splice(divisionIndex, 1);
        if ( this.divisions.length === 0 ) this.hasDivisions = false;
        canvas.scene.deleteEmbeddedDocuments("Drawing", [divID])
        this.render(false, {height: "auto"});
        this.resetFog();
    }

    /**
     * Logic applied when the user selects the save location for the images.
     * Refreshes the application form.
     */
    _onSelectFile(path, filepicker) {
        this.path = path;
        this.hasImgPath = true;
        this.render(false, {height: "auto"});
    }

    /**
     * Activate the SSM FilePicker instance present within the form.
     */
    _activateFilePicker(event) {
        event.preventDefault();
        const options = this._getFilePickerOptions(event);
        options.callback = this._onSelectFile.bind(this);
        const fp = new SSM_FilePicker(options);
        this.filepickers.push(fp);
        return fp.browse();
    }

    /**
     * Logic to prevent the refreshVision method from being called too frequently.
     */
    throttle() {
        const t = Date.now();
        if ( this.refreshTime !== undefined ) {
            const check = (this.refreshTime - t > 0);
            if ( check ) return true
            this.refreshTime = undefined
            return false
        }

        this.refreshTime = t + 50;  // 50ms.  Update the scene 20 times in 1 second.
        return true
    }

    /**
     * Logic that creates a vision source at the mouse cursor location.
     * Then it updates the vision data, including wall information.
     */
    refreshVision(cursorLoc) {
 
        this.vision = new VisionSource(this);
        const d = canvas.dimensions;
        const w = d.sceneRect.width;
        const h = d.sceneRect.height;
        const r = Math.sqrt(w*w + h*h);

        const visionData = {
            x: cursorLoc.x,
            y: cursorLoc.y,
            angle: 360,
            rotation: 0,
            radius: r
        }

        this.vision.initialize(visionData)
        canvas.effects.visionSources.set("SSM_SceneDivider", this.vision);
        canvas.perception.update({refreshVision: true}, true);

        // Save the polygon path generated by clockwiseSweepPolygon.
        this.polygonPaths.add(JSON.stringify(this.vision.los.points));
    }

    /**
     * Deletes the visionSource created by refreshVision().
     */
    endSight() {
        canvas.effects.visionSources.delete("SSM_SceneDivider");
        canvas.perception.update({refreshVision: true}, true);
    }

    /**
     * Logic to create a new compendium (if necessary)
     * Refreshes the application form.
     */
    async createCompendium() {
        // Update the clicked button as this function may take a moment to process
        const btn = document.getElementById('ssm-sd-submit');
        btn.innerText = game.i18n.localize('SSM.Processing');
        btn.disabled = true;
        // Check if the compendium name chosen exists already
        const pack = getCompendiumPack(this.compName);
        // Check if it exists but is of the wrong type...
        if ( pack && pack.metadata.type !== "Scene" ) {
            ui.notifications.warning(`Game pack "${this.compName}" already exists and is not a scene type compendium!.`)
            return false;
        };

        // If it exists and is the correct type, then prompt user to confirm adding more scenes to this pack
        if ( pack ) {
            const title = game.i18n.localize('SSM.SceneDividerUI.ConfirmUsePackTitle');
            const content =     game.i18n.localize('SSM.SceneDividerUI.ConfirmUsePack1') + 
                                `${this.compName}` +
                                game.i18n.localize('SSM.SceneDividerUI.ConfirmUsePack2');
            const confirm = await confirmDialog(title, content);

            if ( !confirm ) return false;
            else return true;
        }

        // Create the pack
        const metadata = {
            label: this.compName,
            type: "Scene"
        }
        await CompendiumCollection.createCompendium(metadata)
        return true;
    }

    /**
     * Logic to create sub-scene .webp images from the scene background image
     */
    async saveSubSceneTextureToFile(division) {

        const subj = PolygonMesher.getClipperPathFromPoints(division.pixiPolygon.points);
        const solution = new ClipperLib.Path();
        const scale = 100;
        ClipperLib.JS.ScaleUpPath(subj, scale);
        const co = new ClipperLib.ClipperOffset();
        co.AddPath(subj, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
        co.Execute(solution, polygonOffsetByPixels * scale);
        ClipperLib.JS.ScaleDownPath(solution[0], scale);

        const flattenClipperPath = (arr) => {
                let points = []
                for (const pt of arr) {
                    points = [...points, Math.round(pt.X), Math.round(pt.Y)];
                }
                return points
        }
        const finalSolution = flattenClipperPath(solution[0]);
    
        const mask = new PIXI.LegacyGraphics();
        mask.beginFill(0x000000);
        mask.drawPolygon(finalSolution);
        mask.endFill();

        for (const layer of ["background", "foreground"]) {
            let tex = undefined;
            let sprite = undefined;
            const src = layer === "background" ? canvas.scene.background.src : canvas.scene.foreground;
            if ( src !== null ) {
                tex = await loadTexture(src);
                sprite = new PIXI.Sprite(tex);
            } else if ( layer !== "foreground" ) {
                tex = PIXI.Texture.WHITE;
                sprite = new PIXI.Sprite(tex);
                const d = canvas.dimensions;
                sprite.width = d.sceneWidth;
                sprite.height = d.sceneHeight;
            }

            if ( tex === undefined ) continue;

            // Edge case where the user has increased/decreased the size of the scene
            sprite.width *= division.boundingBox.texScaleWidth;
            sprite.height *= division.boundingBox.texScaleHeight;

            const tempContainer = new PIXI.Container();
            tempContainer.addChild(sprite);
            tempContainer.addChild(mask);
            mask.x = division.boundingBox.sceneX - polygonOffsetByPixels;
            mask.y = division.boundingBox.sceneY - polygonOffsetByPixels;
            tempContainer.mask = mask;

            const transform = PIXI.Matrix.IDENTITY.clone();
            transform.scale(1,1);
            const tx = division.boundingBox.sceneX;
            const ty = division.boundingBox.sceneY;
            transform.translate(-tx, -ty);

            const texture = PIXI.RenderTexture.create({
                width: division.boundingBox.width + polygonOffsetByPixels * 2,
                height: division.boundingBox.height + polygonOffsetByPixels * 2,
                scaleMode: PIXI.SCALE_MODES.LINEAR,
                resolution: 1
            });

            canvas.app.renderer.render(tempContainer, texture, undefined, transform);

            tempContainer.destroy();

            const image = canvas.app.renderer.extract.base64(new PIXI.Sprite(texture), "image/webp", 1);
            const blob = convertToBlob(image);

            // Save to disk
            const fileName = layer === "background" ? division.subSceneName + ".webp" : division.subSceneName + "_foreground.webp";
            const file = new File([blob], fileName, {type: 'image/webp'});
            await FilePicker.upload("data", this.path, file);

            if ( layer === "foreground" ) division.foregroundSrc = this.path + "/" + fileName;
        }
    }

    /**
     * Logic to create a sub-scene in the compendium.
     */
    async addSubScenesToCompendium(pack) {
        for (const division of this.divisions) {
            // Modifiy data
            const newData = {
                height : division.boundingBox.height + polygonOffsetByPixels * 2,
                width : division.boundingBox.width + polygonOffsetByPixels * 2,
                background: {
                    src: this.path + "/" + division.subSceneName + ".webp"
                },
                foreground: division.foregroundSrc,
                name : division.subSceneName,
                padding : 0,
                grid: {
                    size: division.dims.size}
            };   

            // Then create the scene in the pack
            await Scene.create(newData, {pack: pack.collection});
        }
    }

    /**
     * Collects placeable objects in the main scene that are only found in the sub-scene.
     * Updates the scene in the compendium pack with the placeables (re-creates them).
     * @param {object} pack Foundry pack object
     */
    async cullPlaceablesInPack(pack) {
        for (const scene of pack.contents) {
            // Find the division for this scene...
            const division = this.divisions.filter(d => d.subSceneName === scene.name)[0];

            const cullPlaceables = (placeables) => {
                const updateArray = []
                if ( placeables === "walls" ) {
                    for (const wall of division.wallsInDiv) {
                        const wallObj = wall.document.toObject();
                        wallObj.c[0] -= division.boundingBox.x;
                        wallObj.c[1] -= division.boundingBox.y;
                        wallObj.c[2] -= division.boundingBox.x;
                        wallObj.c[3] -= division.boundingBox.y;

                        updateArray.push(wallObj);
                    }
                } else {
                    const placeablesCopy = canvas.scene[placeables].toObject();
                    for (const placeable of placeablesCopy) {    // is a Map
                        const pt1 = new ClipperLib.IntPoint(placeable.x, placeable.y);
                        if ( ClipperLib.Clipper.PointInPolygon(pt1, division.clipperPathFinal) === 0 ) continue;

                        placeable.x -= division.boundingBox.x,
                        placeable.y -= division.boundingBox.y
                        updateArray.push(placeable);
                    }
                }

                return updateArray;
            }

            await scene.update({
            walls: cullPlaceables("walls"),
            drawings: cullPlaceables("drawings"),
            lights: cullPlaceables("lights"),
            notes: cullPlaceables("notes"),
            sounds: cullPlaceables("sounds"),
            templates: cullPlaceables("templates"),
            tiles: cullPlaceables("tiles"),
            tokens: cullPlaceables("tokens")
        }, {recursive: false})
        }
    }

    /**
     * Examines walls between scenes to determine if it is possible for things
     * that can be sensed (sound, light) to transfer between scenes.  Also looks
     * for allowed movement such as ethereal walls or doors.
     * Creates a data object(used later), and a visual representation on the canvas
     * that can be clicked to be deleted.
     * @param {object} div Instance of Texture2Polygon
     */
    createLinks(div) {

        // Start iterating over previous divisions
        next_division:
        for (const division of this.divisions) {
            
            // If div and division are the same, skip to next.
            if ( div === division) continue;

            // If there is a pre-existing link already, skip to next.
            const linkID = div.drawingID.slice(8) + division.drawingID.slice(-8)
            if ( this.links.has(linkID) ) continue;

            // Check to see if these divisions even have a common edge.  If not, skip to next.
            if ( !isColliding(div.clipperPathFinal, division.clipperPathFinal) ) continue;
            
            // Check to see if these two divisions have a common wall that also allows vision or movement.
            // If yes, create a link and then skip to next.
            for (const wall of div.wallsInDiv) {
                if ( 
                    wall.document.light === 20 &&
                    wall.document.move === 20 &&
                    wall.document.sight === 20 &&
                    wall.document.sound === 20 &&
                    wall.document.door === 0
                ) continue;
                
                for (const w of division.wallsInDiv) {
                    if ( wall.id !== w.id ) continue;
                    const link = this.createLinkGraphic(wall.coords, wall.center);
                    const linkObj = {
                        link: link,
                        divs: [div, division]
                    }
                    this.links.set(linkID, linkObj);
                    continue next_division;
                }
            }

            // Shares an edge but doesn't have any walls that allow vision or movement.
            // Find adjacent edges that don't have walls.

            function polyCoordSlope(polygonPath) {
                const clipperPolygon = Array.isArray(polygonPath[0]) ? polygonPath[0] : polygonPath;
                const coordSlopes = new Set();
                for (let i=0; i < clipperPolygon.length; i++) {
                    const j = i === clipperPolygon.length - 1 ? 0 : i + 1;
                    const obj = {
                        x: clipperPolygon[i].X,
                        y: clipperPolygon[i].Y,
                        slope: slope([clipperPolygon[i].X, clipperPolygon[i].Y], 
                            [clipperPolygon[j].X, clipperPolygon[j].Y]).toString()
                    }

                    coordSlopes.add(JSON.stringify(obj));
                }
                return coordSlopes
            }

            function wallCoordSlope(wallArray) {
                const coordSlopes = new Set();
                for (const wall of wallArray) {
                    const doc = wall.document
                    const obj1 = {
                        x: doc.c[0],
                        y: doc.c[1],
                        slope: slope([doc.c[0], doc.c[1]], [doc.c[2], doc.c[3]]).toString()
                    }
                    const obj2 = {
                        x: doc.c[2],
                        y: doc.c[3],
                        slope: slope([doc.c[2], doc.c[3]], [doc.c[0], doc.c[1]]).toString()
                    }
                    coordSlopes.add(JSON.stringify(obj1));
                    coordSlopes.add(JSON.stringify(obj2));
                }

                return coordSlopes
            }

            // UnionedSlopes is a SET containing coordinate + slope pairs for every point around the perimeter of the two divisions after being unioned.
            const unioned = unionPolygons(div.clipperPathFinal, division.clipperPathFinal, true);
            const unionedSlopes = polyCoordSlope(unioned);

            // divSlopes is a SET containing coordinate + slope pairs for every point around the perimeter of div.
            const divPath = Array.isArray(div.clipperPathFinal[0]) ? div.clipperPathFinal[0] : div.clipperPathFinal;
            const divSlopes = polyCoordSlope(divPath);

            // divisionSlopes is a SET containing coordinate + slope pairs for every point around the perimeter of division.
            const divisionPath = Array.isArray(division.clipperPathFinal[0]) ? division.clipperPathFinal[0] : division.clipperPathFinal;
            const divisionSlopes = polyCoordSlope(divisionPath);

            // coordSlopes is a combined SET containing coordinate + slope pairs for every point around the perimeter of div and division.
            const coordSlopes = new Set([...divSlopes, ...divisionSlopes]);

            // remove all perimeter points from coordSlopes
            let innerCoordSlopes = [...coordSlopes].filter(coord => ![...unionedSlopes].includes(coord));

            // Produce coordinates + slopes for each end of each wall.
            const wallsInDiv = [];
            const allWallsData = canvas.walls.placeables;
            const path = Array.isArray(unioned[0]) ? unioned[0] : unioned;
            for (const wall of allWallsData) {
                const pt1 = new ClipperLib.IntPoint(wall.document.c[0], wall.document.c[1]);
                const pt2 = new ClipperLib.IntPoint(wall.document.c[2], wall.document.c[3]);
                if (    ClipperLib.Clipper.PointInPolygon(pt1, path) === 0 &&
                        ClipperLib.Clipper.PointInPolygon(pt2, path) === 0 ) continue;

                wallsInDiv.push(wall);                            
            }

            const divWallSlopes = wallCoordSlope(wallsInDiv);

            // Remove all points that correspond to a wall.
            innerCoordSlopes = innerCoordSlopes.filter(coord => ![...divWallSlopes].includes(coord));

            // If there's nothing left, just continue to next div.
            if ( !innerCoordSlopes.length ) continue next_division;

            // Clean up the remaining points, sorting by slope.  Not full proof.  If by chance the same slope is produced in two places, this blows up.
            innerCoordSlopes = innerCoordSlopes.map(coord => JSON.parse(coord));

            function sortBySlope(coordObj) {
                if ( sortedInnerCoords.has(coordObj.slope) ) {
                    const coord = sortedInnerCoords.get(coordObj.slope);
                    coord.x2 = coordObj.x;
                    coord.y2 = coordObj.y;
                    sortedInnerCoords.set(coordObj.slope, coord);
                } else {
                    sortedInnerCoords.set(coordObj.slope, {
                        x1: coordObj.x,
                        y1: coordObj.y,
                        x2: undefined,
                        y2: undefined
                    })
                }
            }

            const sortedInnerCoords = new Map();
            innerCoordSlopes.forEach(coord => sortBySlope(coord));

            const wallCoords = [] 
            for (const coord of (sortedInnerCoords.values())) {
                wallCoords.push(coord.x1, coord.y1, coord.x2, coord.y2);
            }

            const midpoint = {
                x: (wallCoords[0] + wallCoords[2]) / 2,
                y: (wallCoords[1] + wallCoords[3]) / 2
            }
            const link = this.createLinkGraphic(wallCoords, midpoint);
            const linkObj = {
                link: link,
                divs: [div, division]
            }
            this.links.set(linkID, linkObj);
        }
    }

    /**
     * Creates a visual representation on the canvas to visually show which sub-scenes
     * will have links to adjacent sub-scenes.  Implements a click handler to be able to
     * delete unwanted links.
     * @param {array} coord     // Foundry wall coordinates, array: [x1, y1, x2, y2]
     * @param {object} center   // {x: <number>, y: <number>}
     * @returns 
     */
    createLinkGraphic(coord, center){
        
        const d = 50; // pixels perpendicular

        const wallSlope = slope([coord[0], coord[1]], [coord[2], coord[3]]);
        let p1, p2;
        if ( wallSlope === 0 ) {
            // Horizontal
            p1 = {x: center.x, y: center.y + d};
            p2 = {x: center.x, y: center.y - d};
        } else if ( isFinite(wallSlope) ) {
            p1 = offsetPointFromSlope(wallSlope, center, d);
            p2 = offsetPointFromSlope(wallSlope, center, -d);
        } else {
            // Vertical
            p1 = {x: center.x + d, y: center.y};
            p2 = {x: center.x - d, y: center.y};
        }

        const deleteLink = this._deleteLink.bind(this);

        const link = new PIXI.LegacyGraphics();
        link.beginFill(0x000000);
        link.drawCircle(p1.x, p1.y, 30);
        link.drawCircle(p2.x, p2.y, 30);
        link.moveTo(p1.x, p1.y);
        link.lineStyle(25, 0x000000);
        link.lineTo(p2.x, p2.y);
        link.beginFill(0xff6400);
        link.lineStyle(10, 0xff6400);
        link.lineTo(p1.x, p1.y);
        link.drawCircle(p1.x, p1.y, 10);
        link.drawCircle(p2.x, p2.y, 10);
        link.endFill();
        link.interactive = true;
        link.on('click', deleteLink);

        this.linkContainer.addChild(link);

        return link;
    }

    _deleteLink(event) {
        for (const [key, value] of this.links) {
            if ( value.link === event.currentTarget ) this.links.delete(key)
        }
        this.linkContainer.removeChild(event.currentTarget);
        event.currentTarget.destroy(true);
    }

    async embedLinkFlags(pack) {
        if ( !game.modules.get("scene-scroller").active ) {
            ui.notifications.info(game.i18n.localize('SSM.SceneDividerUI.SceneScrollerNoFlags'));
            return;
        }
        if ( !this.links.size ) return;
        let subSceneFlagData = foundry.utils.deepClone(game.modules.get("scene-scroller").struct.compendiumSceneFlags);
        const subSceneFlagKeys = Object.keys(subSceneFlagData);
        const subSceneChildrenKeys = Object.keys(game.modules.get("scene-scroller").struct.subSceneChildrenFlags);

        /* Step 1: Begin by iterating all the links to save data in sub-scene flags */
        const clctn = pack.collection;
        for (const [id, link] of this.links) {
            for (const div of link.divs) {
                const otherDiv = div === link.divs[0] ? link.divs[1] : link.divs[0];
                const scn_id = pack.index.getName(div.subSceneName)._id;
                const uuid = `Compendium.${clctn}.${scn_id}`;
                const subScene = await fromUuid(uuid);
                let subSceneChildrenFlagData = foundry.utils.deepClone(game.modules.get("scene-scroller").struct.compendiumSceneFlags[subSceneFlagKeys[0]]);
                if ( subScene.flags.hasOwnProperty(ModuleName) ) {
                    subSceneChildrenFlagData = subScene.getFlag(ModuleName, subSceneFlagKeys[0]);
                }
                const otherScnID = pack.index.getName(otherDiv.subSceneName)._id;
                const otherUUID = `Compendium.${clctn}.${otherScnID}`;
                // Second key temporarily holds div name, to make it easier to find div in next step.
                subSceneChildrenFlagData.push({[subSceneChildrenKeys[0]]: otherUUID, [subSceneChildrenKeys[1]]: otherDiv.subSceneName});
                await subScene.setFlag(ModuleName, subSceneFlagKeys[0], subSceneChildrenFlagData);
            }
        }

        /* Step 2: Iterate every sub-scene to calculate the size (bounds) of the scene needed to hold the sub-scene and child sub-scenes */
        for (const div of this.divisions) {
            let minX = div.boundingBox.sceneX;
            let minY = div.boundingBox.sceneY;
            let maxX = div.boundingBox.sceneX + div.boundingBox.width;
            let maxY = div.boundingBox.sceneY + div.boundingBox.height;

            const scn_id = pack.index.getName(div.subSceneName)._id;
            const uuid = `Compendium.${clctn}.${scn_id}`;
            const subScene = await fromUuid(uuid);
            subSceneFlagData = subScene.getFlag(ModuleName, subSceneFlagKeys[0]);

            for (const data of subSceneFlagData) {
                for (const division of this.divisions) {
                    if ( division.subSceneName !== data[subSceneChildrenKeys[1]] ) continue;
                    minX = minX < division.boundingBox.sceneX ? minX : division.boundingBox.sceneX;
                    minY = minY < division.boundingBox.sceneY ? minY : division.boundingBox.sceneY;
                    maxX = maxX > (division.boundingBox.sceneX + division.boundingBox.width) ? maxX : division.boundingBox.sceneX + division.boundingBox.width;
                    maxY = maxY > (division.boundingBox.sceneY + division.boundingBox.height) ? maxY : division.boundingBox.sceneY + division.boundingBox.height;
                    break;
                }
            }
            
            /* Calculate sub-scene coordinates relative to minX & minY and save them in flags */

            // Bounds for the parent sub-scene
            const bounds = {
                minX: minX,
                minY: minY,
                width: maxX - minX,
                height: maxY - minY
            }
            await subScene.setFlag(ModuleName, subSceneFlagKeys[1], bounds);

            // Coords for the parent sub-scene
            const coords = {
                x: div.boundingBox.sceneX - minX,
                y: div.boundingBox.sceneY - minY,
            }
            await subScene.setFlag(ModuleName, subSceneFlagKeys[2], coords);
        }

        // Coords for all the children sub-scenes
        for (const div of this.divisions) {
            const scn_id = pack.index.getName(div.subSceneName)._id;
            const uuid = `Compendium.${clctn}.${scn_id}`;
            const subScene = await fromUuid(uuid);

            // Get an array of children
            subSceneFlagData = subScene.getFlag(ModuleName, subSceneFlagKeys[0]);
            // Get the bounds for the parent
            const parentBounds = subScene.getFlag(ModuleName, subSceneFlagKeys[1]);
            for (const data of subSceneFlagData) {
                for (const division of this.divisions) {
                    if ( division.subSceneName !== data[subSceneChildrenKeys[1]] ) continue;
                    data[subSceneChildrenKeys[1]] = {
                        x: division.boundingBox.sceneX - parentBounds.minX,
                        y: division.boundingBox.sceneY - parentBounds.minY,
                        width: division.boundingBox.width,
                        height: division.boundingBox.height
                    }
                    break;
                }
            }
            await subScene.setFlag(ModuleName, subSceneFlagKeys[0], subSceneFlagData);
        }
    }
}

/** Extension of the core's FilePicker class to allow the creation of folders by:
 *  1) override the get defaultOptions() to use a different template, and
 *  2) create a new variable similar to canUpload() with the 'folder' type restriction removed, and
 *  3) override the getData() method to add the new variable.
 */
 class SSM_FilePicker extends FilePicker {
    constructor(options={}) {
        super(options);
    }

    /** 
     * @override
     * @returns {FilePickerOptions}
     */
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            template: `./modules/${ModuleName}/templates/filepicker.hbs`,
            classes: ["filepicker"],
            width: 520,
            tabs: [{navSelector: ".tabs"}],
            dragDrop: [{dragSelector: ".file", dropSelector: ".filepicker-body"}],
            tileSize: false,
            filters: [{inputSelector: 'input[name="filter"]', contentSelector: ".filepicker-body"}],
          });
    }

    /**
     * Return a flag for whether the current user is able to create a new folder
     * @return {boolean}
     */
    get canCreateFolders() {
        if ( this.options.allowUpload === false ) return false;
        if ( !["data", "s3"].includes(this.activeSource) ) return false;
        return !game.user || game.user.can("FILES_UPLOAD");
    }

    /**
     * @override
     * @returns {TemplateInputs}
     */
    async getData(options) {
        const data = await super.getData(options);
        data.canCreateFolders = this.canCreateFolders;
        if ( options.type === "folder") data.allowUpload = false;

        return data;
    }
}

export class SSM_ConvertImage extends FormApplication {
    constructor(resolve, {batch = false, compression = true, submitOnChange = false, path = null}={}) {
        super();
        this.result = resolve;
        this.batch = batch;
        this.compression = compression;
        this.options.submitOnChange = submitOnChange;
        this.path = path;
    }

    static get defaultOptions() {
        return mergeObject(super.defaultOptions, {
            width: 500,
            template: `modules/${ModuleName}/templates/ssm-convert-image.hbs`,
            id: "ssm-convert-image",
            title: game.i18n.localize('SSM.ConvertImageUI.Title'),
            submitOnChange: false,
            closeOnSubmit: true
        })
    }

    getData() {
        return {
            compression: 0.9,
            isBatch: this.batch,
            isCompression: this.compression,
            isPath: this.path ?? false
        }
    }

    _updateObject(event, formData) {
        return this.result(formData)
    }
}

export class SSM_ResizeImage extends FormApplication {
    constructor(resolve, tile, {compression = true} = {}, options) {
        super({}, options);
        this.result = resolve;
        this.tile = tile.object;
        this.isCompression = compression;
        this.drag = false;
        this.widthFocus = false;
        this.heightFocus = false;
        this._onHandleDragMoveHolder = Tile.prototype._onHandleDragMove;
        this._dragRightMoveHolder = canvas.mouseInteractionManager.callbacks.dragRightMove;

        this.initialize();
    }

    static get defaultOptions() {
        return mergeObject(super.defaultOptions, {
            width: 500,
            template: `modules/${ModuleName}/templates/ssm-resize-image.hbs`,
            id: "ssm-resize-image",
            title: game.i18n.localize('SSM.ResizeImageUI.Title'),
            submitOnChange: false,
            closeOnSubmit: true
        })
    }

    getData() {
        return {
            compression: 0.9,
            isCompression: this.isCompression,
            tileWidth : Math.round(this.tile.document.width),
            tileHeight : Math.round(this.tile.document.height)
        }
    }

    _updateObject(event, formData) {
        return this.result(formData)
    }

    _onKeyDown(event) {
        // Close dialog
        if ( event.key === "Escape" ) {
            event.preventDefault();
            event.stopPropagation();
            return this.close();
        }

        if ( event.key === "Enter" && (this.widthFocus === true || this.heightFocus === true) ) {
            event.preventDefault();
            event.stopPropagation();
            if ( this.widthFocus ) {
                this.widthFocus = false;
                return this._widthChange()
            } else {
                this.heightFocus = false;
                return this._heightChange();
            }
        }

        if ( event.key === "Enter" ) this.submit();
    }

    activateListeners(html) {
        super.activateListeners(html);

        html.find("#ssm-resize-width").focus(this._widthFocus.bind(this));
        html.find("#ssm-resize-height").focus(this._heightFocus.bind(this));
        html.find("#ssm-resize-width").change(this._widthChange.bind(this));
        html.find("#ssm-resize-height").change(this._heightChange.bind(this));
        document.addEventListener("keydown", this._onKeyDown.bind(this));
    }

    close(options={}, flag = false) {
        this.result(flag);
        return super.close(options);
    }

    SSM_onHandleDragMove(event) {
        this.drag = true
        const onHandleDragMove = this._onHandleDragMoveHolder.bind(this.tile);
        onHandleDragMove(event);
        return this.render();
    }

    SSM_onHandleDragDrop(event) {
        let {destination, origin, originalEvent} = event.data;
        if ( !originalEvent.shiftKey ) {
          destination = canvas.grid.getSnappedPosition(destination.x, destination.y, this.tile.layer.gridPrecision);
        }
        const d = this.tile._getResizedDimensions(originalEvent, origin, destination);
        this.tile.document.width = this.tile.document._source.width  = d.width;
        this.tile.document.height = this.tile.document._source.height = d.height;
        return this.render();
    }

    async initialize() {

        this.tile._onHandleDragMove = this.SSM_onHandleDragMove.bind(this);
        this.tile.mouseInteractionManager.callbacks.dragLeftDrop = this.SSM_onHandleDragDrop.bind(this);
        this.tile.mouseInteractionManager.callbacks.clickRight = () => {};
        this.tile.mouseInteractionManager.callbacks.dragRightMove = this._dragRightMoveHolder;

    }

    _widthFocus() {
        this.widthFocus = true;
        this.drag = false;
    }

    _heightFocus() {
        this.heightFocus = true;
        this.drag = false;
    }

    async _widthChange() {
        if ( this.drag ) return;
        const width = document.getElementById('ssm-resize-width');
        this.tile.document.width = parseInt(width.value);
        this.tile.refresh();
        const el = document.querySelector( ':focus' );
        if ( el ) el.blur();
    }

    async _heightChange() {
        if ( this.drag ) return;
        const height = document.getElementById('ssm-resize-height');
        this.tile.document.height = parseInt(height.value);
        this.tile.refresh();
        const el = document.querySelector( ':focus' );
        if ( el ) el.blur();
    }
}

export class SSM_CropImage extends FormApplication {
    constructor(resolve, {compression = true}={}) {
        super();
        this.result = resolve;
        this.isCompression = compression;
    }

    static get defaultOptions() {
        return mergeObject(super.defaultOptions, {
            width: 500,
            template: `modules/${ModuleName}/templates/ssm-crop-image.hbs`,
            id: "ssm-crop-image",
            title: game.i18n.localize('SSM.CropImageUI.Title'),
            submitOnChange: false,
            closeOnSubmit: true
        })
    }

    getData() {
        return {
            compression: 0.9,
            isCompression : this.isCompression
        }
    }

    _updateObject(event, formData) {
        return this.result(formData)
    }

    _onKeyDown(event) {
        // Close dialog
        if ( event.key === "Escape" ) {
            event.preventDefault();
            event.stopPropagation();
            return this.close();
        }
    }

    close(options={}, flag = false) {
        this.result(flag);
        return super.close(options);
    }
}

/** Form application that will be invoked when a user wants to link a scene to another.
 *  The form will request the user choose a compendium and then the scene.
 */
 export class PickScene extends FormApplication {
    constructor(resolve, template = "initialize.hbs") {
      super();
      
      this.options.template = template === "initialize.hbs" ? this.options.template : `./modules/${ModuleName}/templates/${template}`;
      this.options.title = template === "initialize.hbs" ? this.options.title : game.i18n.localize('SSM.PickSceneUI.Title2');
      this.compendiumList = game.packs
                            .filter(p => p.documentName === "Scene")
                            .map(p => {return p.title});
      this.compendiumChoice = null;
      this.sceneList = [];
      this.callback = (result) => resolve(result);
  
      Handlebars.registerHelper('comp_equal', function(picked) {
        return this === picked;
      })
    }
  
    close(options={}) {
      if ( !options.resolved ) this.callback(null)
      return super.close(options);
    }
  
    static get defaultOptions() {
      return mergeObject(super.defaultOptions, {
        width: 400,
        template: `./modules/${ModuleName}/templates/initialize.hbs`,
        id: "scene-scroller-maker-pick-form",
        title: game.i18n.localize('SSM.PickSceneUI.Title1'),
        submitOnChange: true,
        closeOnSubmit: false
      })
    }
  
    getData() {
      // Send compendium choice and list of scenes to the template
      if (this.compendiumChoice !== null) {
        // List of scenes in selected compendium for selection box
        this.sceneList = [];
        const compndm = game.packs.filter(p => p.title === this.compendiumChoice)[0];
        for (const scn of compndm.index.contents) {
          this.sceneList.push(scn.name);
        }
      }
  
      // Send list of scene compendiums to the template
      return {
        compSelectText: game.i18n.localize('SSM.InitiateSceneUI.Instructions.SelectCompendium'),
        defaultSelect: game.i18n.localize('SSM.InitiateSceneUI.SelectDefault'),
        sceneSelectText: game.i18n.localize('SSM.InitiateSceneUI.Instructions.SelectScene'),
        compendiumList: this.compendiumList,
        compendium: this.compendiumChoice,
        sceneList: this.sceneList
      }
    }
  
    activateListeners(html) {
      super.activateListeners(html);
    }
  
    _updateObject(event, formData) {
      if (!formData.z_scene_sel || formData.z_scene_sel === "no_selection") {
        if (formData.z_comp_sel === "no_selection") return
        this.compendiumChoice = formData.z_comp_sel;
        this.render(true);
        return;
      }
      if (formData.z_scene_sel) {
        const sourceUUID = getUUID(formData.z_comp_sel, formData.z_scene_sel);
        Handlebars.unregisterHelper('comp_equal');
        this.callback(sourceUUID);
        this.close({resolved: true});
      }
    }
  }

  /** Form application that will be invoked by the settings menu to select or create a default compendium
 */
export class SSM_SelectDefaultCompendium extends FormApplication {
    constructor() {
      super();
      
        this.compendiumList = game.packs
                            .filter(p => p.documentName === "Scene")
                            .map(p => {return p.title});
        this.radioVal = 0;
  
      Handlebars.registerHelper('comp_equal', function(picked) {
        return this === picked;
      })
    }
  
    static get defaultOptions() {
      return mergeObject(super.defaultOptions, {
        width: 500,
        template: `./modules/${ModuleName}/templates/ssm-config-select-compendium.hbs`,
        id: "ssm-settings-select-compendium",
        title: game.i18n.localize('SSM.DefaultSceneCompendiumMenu.UI.Title'),
        submitOnChange: true,
        closeOnSubmit: false
      })
    }
  
    getData() {
  
      // Send list of scene compendiums to the template
      return {
        noRadio: this.radioVal === 0 ? true : false,
        createRadio: this.radioVal === 1 ? true : false,
        chooseRadio: this.radioVal === 2 ? true : false,
        submitRadio: this.radioVal > 0 ? true : false,
        createLabel: game.i18n.localize("SSM.DefaultSceneCompendiumMenu.UI.CreateLabel"),
        selectLabel: game.i18n.localize("SSM.DefaultSceneCompendiumMenu.UI.SelectLabel"),
        createInputLabel: game.i18n.localize("SSM.DefaultSceneCompendiumMenu.UI.CreateInputLabel"),
        submitLabel : game.i18n.localize("SSM.DefaultSceneCompendiumMenu.UI.SubmitButton"),
        compendiumList: this.compendiumList,
        currentLabel: game.i18n.localize("SSM.DefaultSceneCompendiumMenu.CurrentLabel"),
        current: game.settings.get(ModuleName, "defaultSceneCompendium")
      }
    }
  
    activateListeners(html) {
      super.activateListeners(html);
    }
  
    async _updateObject(event, formData) {
        const rVal = parseInt(formData["ssm-comp-choice"]);
        if ( rVal !== this.radioVal ) {
            this.radioVal = rVal;
            this.render(false, {height: "auto"});
        }

        if ( event.type === "submit") {

            switch(rVal) {
                case 1:
                    // Check if the compendium name chosen exists already
                    const pack = getCompendiumPack(formData["ssm-create-name"]);
                    if ( pack ) {
                        ui.notifications.warning(`Compendium "${formData["ssm-create-name"]}" already exists!`)
                        this.render(false, {height: "auto"});
                        return;
                    };

                    // Create the compendium
                    const metadata = {
                        label: formData["ssm-create-name"],
                        type: "Scene"
                    }
                    await CompendiumCollection.createCompendium(metadata)

                    // Set as default
                    game.settings.set(ModuleName, "defaultSceneCompendium", formData["ssm-create-name"])
                    break;
                case 2:
                    // Set as default
                    game.settings.set(ModuleName, "defaultSceneCompendium", formData["z_comp_sel"])
                    break;
            }

            Handlebars.unregisterHelper('comp_equal');
            this.close()
        }
    }
  }