import { ModuleName } from "../ssm-launch.js";
import { Texture2Polygon } from "./poly_from_texture.js";
import { getCompendiumPack, hasImgPath, getSceneBoundsAsClipper, saveImgAsWebP } from "./functions.js";
import { SSM_FilePicker } from "./forms.js";
import { _createLinks, _embedLinkFlags } from "../dev/dev.js";

export const polygonOffsetByPixels = 2;

export class SSM_SceneDivider extends FormApplication {
    constructor() {
        super();

        this.currentStep = 1                // variable to track steps in template
        this.currentRadio = ""              // variable to track radio selections
        this.path = game.settings.get(ModuleName, "defaultImagePath");  // path to directory to save images
        this.pathIsSet = false;
        this.hasDivisions = false;          // boolean for handlebars template
        this.divisions = [];                // Array of Texture2Polygon instances
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
        // Used to prevent the creation of a vision source in the padding area.
        this.sceneBounds = getSceneBoundsAsClipper(1);

        // Needed as location options to save scenes
        this.compendiumList = game.packs
                            .filter(p => p.documentName === "Scene")
                            .map(p => {return p.title});
        this.selectedCompendium = "";

        // To draw the graphics for the links on the canvas.
        canvas.stage.addChild(this.linkContainer);

        Handlebars.registerHelper('comp_equal', function(picked) {
            return this === picked;
          })

        this.createLinks = _createLinks.bind(this);
        this.embedLinkFlags = _embedLinkFlags.bind(this);
    }

    /** ********************************************************************************************************************** */
    /** Standard FormApplication Overrides */
    /** ********************************************************************************************************************** */


    static get defaultOptions() {
        return mergeObject(super.defaultOptions, {
            width: 500,
            template: `./modules/${ModuleName}/templates/ssm-scene-divider.hbs`,
            id: "ssm-scene-divider",
            title: game.i18n.localize('SSM.SceneDividerUI.Title'),
            submitOnChange: true,
            closeOnSubmit: false
        })
    }

    async getData() {

        // Gather data here.
        const returnObj = {
            step1 : this.currentStep === 1 ? true : false,
            step1Ready: this.isReadyForStep3(),
            step2 : this.currentStep === 2 ? true : false,
            step3 : this.currentStep === 3 ? true : false,
            step4 : this.currentStep === 4 ? true : false,
            hasDivisions: this.hasDivisions,
            divisions: this.divisions,
            hasInWorkDivision: this.hasInWorkDivision,
            isExplored: this.isExplored,
            hasDefaultImgPath: await hasImgPath(),
            isDefaultAndNotSet: await this.isDefaultAndNotSet(),
            isPathSet: this.pathIsSet,
            currentPath: this.path,
            hasDefaultCompPath: getCompendiumPack(game.settings.get(ModuleName, "defaultSceneCompendium")),
            sceneRadio1: this.currentRadio === "1" ? true : false,
            sceneRadio2: this.currentRadio === "2" ? true : false,
            sceneRadio3: this.currentRadio === "3" ? true : false,
            sceneRadio4: this.currentRadio === "4" ? true : false,
            sceneRadio5: this.currentRadio === "5" ? true : false,
            defaultCompendium: game.settings.get(ModuleName, "defaultSceneCompendium"),
            compendiumList : this.compendiumList,
            selectedCompendium : this.selectedCompendium
        }

        return returnObj
    }

    activateListeners(html) {
        super.activateListeners(html);
        document.addEventListener("keydown", this._onKeyDown.bind(this));
    }

    // Logic when form is submitted.
    async _updateObject(event, formData) {

        if ( event.type === "change" ) {
            if ( 'subSceneName' in formData ) this._divContinue.apply(this);
            if ( 'ssm-default-imgPath' in formData ) {
                switch(formData["ssm-default-imgPath"]) {
                    case "1":
                        this.path = game.settings.get(ModuleName, "defaultImagePath");
                        this.pathIsSet = false;
                        break;
                    case "2":
                        if ( this.path === game.settings.get(ModuleName, "defaultImagePath") ) this.path = "";
                        else this.path = formData["ssm-path-choice-current"];
                        this.pathIsSet = true;
                        break;
                }
                this.render(false);
            }
            if ( 'ssm-scene-loc' in formData ) {
                if ( formData["ssm-scene-loc"] !== this.currentRadio ) this.selectedCompendium = "";
                switch (formData["ssm-scene-loc"]) {
                    case "1":
                        break;
                    case "2":
                        if ( 'ssm-scene-choice-current' in formData && formData["ssm-scene-loc"] === this.currentRadio ) this.selectedCompendium = formData["ssm-scene-choice-current"];
                        else this.selectedCompendium = game.i18n.localize("SSM.InitiateSceneUI.SelectDefault");
                        break;
                    case "3":
                        if ( 'ssm-scene-choice-current' in formData && formData["ssm-scene-loc"] === this.currentRadio ) this.selectedCompendium = formData["ssm-scene-choice-current"];
                        break;
                    case "4":
                        break;
                }
                this.currentRadio = formData["ssm-scene-loc"];
                this.render(false);
            }
            return;
        }

        if ( event.type === "submit") {
            if ( event.submitter.id === "ssm-stp1-stp2" ) this._createDiv.apply(this);
            if ( event.submitter.id === "div-trash" ) this._deleteDiv.apply(this, [event.submitter.dataset.id]);
            if ( event.submitter.id === "ssm-stp2-stp1" ) this._launchT2P.apply(this);
            if ( event.submitter.id === "ssm-stp1-stp3" ) this._toImgPath.apply(this);
            if ( event.submitter.id === "ssm-stp3-stp1") this._resetToStep1.apply(this);
            if ( event.submitter.id === "ssm-stp3-stp4") this._toCompSelect.apply(this);
            if ( event.submitter.id === "ssm-stp4-stp3") this._step4To3.apply(this);
            if ( event.submitter.id === "ssm-stp4-submit") {
                await this._processSelections.apply(this, [
                    formData["ssm-scene-loc"],
                    formData["ssm-scene-choice-current"]
                ]);
                this.close();
            }
        }
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

    /** ********************************************************************************************************************** */
    /** Template state logic */
    /** ********************************************************************************************************************** */

    isReadyForStep3() {
        if ( this.currentStep === 1 && this.hasDivisions ) return true;
        return false;
    }

    _resetToStep1() {
        this.currentStep = 1;
        this.render(false, {width: 500, height: "auto"});
    }

    async isDefaultAndNotSet() {
        if (  await hasImgPath() && !this.pathIsSet ) return true;
        return false;
    }

    _toImgPath() {
        this.currentStep = 3;
        this.render(false, {width: 500, height: "auto"});
    }

    _toCompSelect() {
        this.currentStep = 4;
        if ( getCompendiumPack(game.settings.get(ModuleName, "defaultSceneCompendium")) ) this.currentRadio = "1";
        else this.currentRadio = "4";
        this.selectedCompendium = game.i18n.localize("SSM.SceneDividerUI.CompNoneSelected");
        this.render(false, {width: 500, height: "auto"});
    }

    _step4To3() {
        this.currentStep = 3;
        this.render(false, {width: 500, height: "auto"});
    }

    /** ********************************************************************************************************************** */
    /** Can be optionally called to load saved flag data, before rendering the template/UI */
    /** ********************************************************************************************************************** */

    async loadFlagData() {

        const dataArr = canvas.scene.getFlag(ModuleName, "StoredDivs");

        for (const divData of dataArr) {
            this.hasDivisions = true;
            this.hasInWorkDivision = false;
            const T2P = new Texture2Polygon(this);
            await T2P.processDivData(divData);
            this.divisions.push(T2P);
        }
    }



    /** ********************************************************************************************************************** */
    /** Other functions */
    /** ********************************************************************************************************************** */

    // Adds the close function when the dialog is closed via ESC key.
    _onKeyDown(event) {
        // Close dialog
        if ( event.key === "Escape" ) {
            event.preventDefault();
            event.stopPropagation();
            return this.close();
        }
    }

    async _processSelections(choice, sceneSaveLoc) {
        // pre-processing
        if ( choice === "3" ) {
            // Create the compendium if it doesn't already exist
            const confirm = await this.createCompendium(sceneSaveLoc);
            if ( !confirm ) return;
        }

        // Processing choice
        let pack = undefined;
        switch(choice) {
            case "1":
            case "2":
            case "3":
                pack = getCompendiumPack(sceneSaveLoc);
            case "4":
                this._divideScenes.apply(this, [pack]);
                break;
            case "5":
                this._saveToFlags.apply(this);
                break;
        }
    }

    async _divideScenes(pack = undefined) {
        // Create all of the scene backgrounds and save at selected location
        for (const division of this.divisions) {
            await this.saveSubSceneTextureToFile(division);
        }
        await this.restoreWalls();
        await this.deletePolyDrawings();
        // Create all of the scenes and save them in the compendium
        await this.addSubScenesToLoc(pack);
        // Embed links into the sub-scenes.
        await this.embedLinkFlags(pack);
    }

    _saveToFlags() {
        // Assemble the object that will be saved to flags.
        const divArray = [];
        for (const div of this.divisions) {
            const obj = {
                name: div.subSceneName,
                boundingBox: div.boundingBox
            }
            divArray.push(obj);
        }
        canvas.scene.setFlag(ModuleName, "StoredDivs", divArray);
        ui.notifications.info(game.i18n.localize("SSM.SceneDividerUI.SavedToFlags"));
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
     * Sets the UI to the Token Layer
     */
    setTokenLayer() {
        if ( canvas["tokens"].active) ui.controls.initialize({tool: "token"});
        else canvas["tokens"].activate({tool: "token"});
    }

    /**
     * Deletes and resets any existing fog exploration.
     */
    resetFog() {
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
     * Function initiates after user has painted the bounds of the new sub-scene and clicked 'continue'
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
        this.currentStep = 1;
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
     * Logic applied when user clicks the continue button after entering a sub-scene name.
     * Refreshes the application form.
     */
    _divContinue() {

        // If the user didn't enter any text for the name field
        const isText = document.getElementById("div-input").value;
        if ( isText === "" ) {
            ui.notifications.info(game.i18n.localize('SSM.SceneDividerUI.ErrorNoSubSceneName'));
            return;
        }

        this.currentStep = 2;
        this.resetFog();
        this.inWorkDivTitle = isText;

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
    _deleteDiv(drwID) {
        const divisionIndex = this.divisions.findIndex(d => d.drawingID === drwID);
        this.divisions.splice(divisionIndex, 1);
        if ( this.divisions.length === 0 ) this.hasDivisions = false;
        canvas.scene.deleteEmbeddedDocuments("Drawing", [drwID])
        this.render(false, {height: "auto"});
        this.resetFog();
    }

    /**
     * Logic applied when the user selects the save location for the images.
     * Refreshes the application form.
     */
    _onSelectFile(path, filepicker) {
        this.path = path;
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
    async createCompendium(compendiumName) {
        
        const pack = getCompendiumPack(compendiumName);
        // Check if it exists but is of the wrong type...
        if ( pack  ) {
            ui.notifications.warning(`Game pack "${compendiumName}" already exists!`)
            return false;
        };

        // Create the pack
        const metadata = {
            label: compendiumName,
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
            const fp = new FilePicker({type: "image"});
            if ( src !== null ) {
                const [source, target] = fp._inferCurrentDirectory(this.path);
                fp.activeSource = source;
                fp.sources[source].target = target;
                tex = await loadTexture(src);
                sprite = new PIXI.Sprite(tex);
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

            const fileName = layer === "background" ? division.subSceneName + ".webp" : division.subSceneName + "_foreground.webp";
            const imgPath = saveImgAsWebP(fp, 1, this.path + "/" + fileName, texture, true);

            if ( layer === "foreground" ) division.foregroundSrc = imgPath;
        }
    }

    /**
     * Logic to create a sub-scene at the chosen location (scene folder or in a compendium).
     */
    async addSubScenesToLoc(pack) {
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

            // Then create the scene in the location
            let newScene;
            if ( pack === undefined ) newScene = await Scene.create(newData);
            else newScene = await Scene.create(newData, {pack: pack.collection});
            // Add placeables to the new scene
            await this.cullPlaceablesInSubScene(newScene);
        }
    }

    /**
     * Collects placeable objects in the main scene that are only found in the sub-scene.
     * Updates the scene in the compendium pack with the placeables (re-creates them).
     * @param {object} pack Foundry pack object
     */
    async cullPlaceablesInSubScene(scene) {
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