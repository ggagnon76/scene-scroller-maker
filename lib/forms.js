import { ModuleName } from "../ssm-launch.js";
import { Texture2Polygon } from "./poly_from_texture.js";
import { confirmDialog, generatePixiPolygon } from "./functions.js";

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
        this.hasInWorkDivision = false;     // boolean for handlebars template
        this.inWorkDivTitle = "";           // Name of sub-scene.  Also the filename for the image.
        this.vision = undefined;            // Object containing vision data when defining sub-scene area
        this.refreshTime = undefined;       // Used in throttle function, used in refreshVision method
        this.cursorLoc = {};                // Coordinates of cursor, ussed in refreshVision method
        this.instanceWalls = new Map();     // Map of walls identified by refreshVision method

        this.convertWalls();                // Blocks vision for windows, open doors, etc..
        this.setTokenLayer();               // When the application is launched, resets the ui to Token Layer
    }

    static get defaultOptions() {
        return mergeObject(super.defaultOptions, {
            width: 800,
            template: `./modules/${ModuleName}/templates/ssm-scene-divider.hbs`,
            id: "ssm-scene-divider",
            title: game.i18n.localize('SSM.SceneDividerUI.Title'),
            submitOnChange: false,
            closeOnSubmit: false
        })
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
    }

    // Logic when form is submitted.
    async _updateObject(event, formData) {
        // Create the compendium if it doesn't already exist
        const confirm = await this.createCompendium();
        if ( !confirm ) return;
        const packName = this.compName.toLowerCase();
        const pack = game.packs.get(`world.${packName}`);
        // Create all of the scene backgrounds and save at selected location
        for (const division of this.divisions) {
            await this.saveSubSceneTextureToFile(division);
        }
        // Create all of the scenes and save them in the compendium
        await this.restoreWalls();
        await this.deletePolyDrawings();
        await this.addSubScenesToCompendium(pack);
        await this.cullPlaceablesInPack(pack);

        this.close();
    }

    /**
     * Deletes the drawing polygons added by the application to visually represent the areas
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
     * Over-ride the close method add more logic.
     * @param {object} options Foundry options
     */
    async close(options={}) {

        await this.deletePolyDrawings();
        
        this.endSight();
        libWrapper.unregister_all(ModuleName);

        this.restoreWalls();

        return super.close(options);
    }

    /**
     * Sets the UI to the Token Layer
     */
    setTokenLayer() {
        if ( ui.controls.activeControl === "token") return;
        ui.controls.activeControl = "token";
        canvas["tokens"].activate();
    }

    /**
     * Deletes and resets any existing fog exploration.
     */
    async resetFog() {
        const fogs = game.collections.get("FogExploration");
        const fogIds = [];
        for ( let fog of fogs ) {
          if ( fog.data.scene === canvas.scene.id ) fogIds.push(fog.data.document.id);
        }
        await canvas.sight.exploration.constructor.deleteDocuments(fogIds);
        canvas.sight.pending.removeChildren().forEach(c => c.destroy(true));
        canvas.sight._fogUpdated = false;
        canvas.sight.saved.texture.destroy(true);

        const fogExplorationCls = getDocumentClass("FogExploration");
        canvas.sight.exploration = new fogExplorationCls();
        canvas.sight.saved.texture = PIXI.Texture.EMPTY;
    }

    /**
     * In-memory only update to walls in order to make windows, open doors, etc... block vision.
     */
    async convertWalls() {
        const seeThruWalls = canvas.walls.placeables.filter(w => w.data.sight === 0);
        for (const wall of seeThruWalls) {
            await wall.document.data.update({  // In memory update only
                flags: {
                    [ModuleName] : {
                        sight: wall.data.sight
                    }
                },
                sight: 20
            })
        }
        const openDoors = canvas.walls.placeables.filter(d => d.data.ds === 1);
        for (const door of openDoors) {
            await door.document.data.update({ // In memory update only
                flags: {
                    [ModuleName] : {
                        ds: door.data.ds
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
        const seeThruWalls = canvas.walls.placeables.filter(w => w.data.flags.hasOwnProperty(ModuleName));
        for (const wall of seeThruWalls) {
            if ( wall.data.flags[ModuleName].hasOwnProperty("sight") ) {
                await wall.document.data.update({
                    sight: wall.data.flags[ModuleName].sight
                });
            } else await wall.document.data.update({
                ds: wall.data.flags[ModuleName].ds
            });
        }
    }

    /**
     * Creates an instance of the Texture2Polygon class.
     * Refreshes the application form.
     */
    async _launchT2P() {
        // Update the clicked button as this function may take a moment to process
        const btn = document.getElementById('dvdg-continue');
        if ( btn.innerText === game.i18n.localize('SSM.SceneDividerUI.Processing') ) return;
        btn.innerText = game.i18n.localize('SSM.SceneDividerUI.Processing');
        btn.disabled = true;
        // Need to commit the fog exploration changes.
        canvas.sight.commitFog();
        const T2P = new Texture2Polygon(this);
        const confirm = await T2P.generateDrawingPolygon();

        libWrapper.unregister_all(ModuleName);

        if ( confirm ) {
            this.divisions.push(T2P);
            this.hasDivisions = true;
        }
        
        this.instanceWalls = new Map();
        this.hasInWorkDivision = false;
        this.isDividing = false;
        this.isExplored = false;
        this.inWorkDivTitle = "";
        this.render(false, {width: 800, height: "auto"});
    }

    /**
     * Logic applied when user clicks button to create a new division.
     * Refreshes the application form.
     */
    _createDiv() {
        if ( this.hasInWorkDivision ) {
            ui.notifications.info(game.i18n.localize('SSM.SceneDividerUI.ErrorDivNotFinish'));
            return;
        }
        this.hasInWorkDivision = true;
        this.resetFog();
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
        const isText = document.getElementById("div-input").value;
        if ( isText === "" ) {
            ui.notifications.info(game.i18n.localize('SSM.SceneDividerUI.ErrorNoSubSceneName'));
            return;
        }
        this.inWorkDivTitle = isText;
        this.isDividing = true;

        // Use arrow function so this = SSM_SceneDivider
        libWrapper.register(ModuleName, 'TokenLayer.prototype._onClickLeft', (event) => {

            this.cursorLoc = {x: event.data.origin.x, y: event.data.origin.y};
            this.refreshVision();

        }, "OVERRIDE");

        // Use arrow function so this = SSM_SceneDivider
        libWrapper.register(ModuleName, 'MouseInteractionManager.prototype._handleDragStart', (wrapper, event) => {
            if ( canvas.mouseInteractionManager._dragRight ) return wrapper(event);
            
            this.isExplored = true;
            this.render(false, {width: 300, height: "auto"});

        }, "MIXED");

        // Use arrow function so this = SSM_SceneDivider
        libWrapper.register(ModuleName, 'MouseInteractionManager.prototype._handleDragMove', (wrapper, event) => {
            if ( canvas.mouseInteractionManager._dragRight ) return wrapper(event);

            if ( this.throttle() ) return;
            this.cursorLoc = {x: event.data.destination.x, y: event.data.destination.y};
            this.refreshVision();

        }, "MIXED");

        // Use arrow function so this = SSM_SceneDivider
        libWrapper.register(ModuleName, 'MouseInteractionManager.prototype._handleDragDrop', (wrapper, event) => {
            if ( canvas.mouseInteractionManager._dragRight ) return wrapper(event);

            this.endSight();
        }, "MIXED");

        this.render(false, {width: 300, height: "auto"});
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
    refreshVision() {
 
        this.vision = new VisionSource(this);
        const d = canvas.dimensions;
        const w = d.sceneRect.width;
        const h = d.sceneRect.height;
        const r = Math.sqrt(w*w + h*h);

        const visionData = {
            x: this.cursorLoc.x,
            y: this.cursorLoc.y,
            dim: 0,
            bright: r,
            angle: 360,
            rotation: 0
        }

        this.vision.initialize(visionData)

        const rays = this.vision.los.rays.filter(r => 
                r.result.target.x >= 0 && 
                r.result.target.x <= d.width &&
                r.result.target.y >= 0 &&
                r.result.target.y <= d.height
            )
        
        for (const ray of rays) {
            for (const polyVertex of ray.result.collisions) {
                for (const polyEdge of polyVertex.edges) {
                    const wall = polyEdge.wall;
                    if (    wall.data.c[0] < 0 ||
                            wall.data.c[0] > d.width ||
                            wall.data.c[1] < 0 ||
                            wall.data.c[1] > d.height ||
                            wall.data.c[2] < 0 ||
                            wall.data.c[2] > d.width ||
                            wall.data.c[3] < 0 ||
                            wall.data.c[3] > d.height
                        ) continue;
                    
                    this.instanceWalls.set(wall.id, wall);
                }
            }
        }

        canvas.sight.sources.set("SSM_SceneDivider", this.vision);

        canvas.perception.update({
            sight: {
                refresh: true,
                forceUpdateFog: true
            },
            lighting: {refresh: true},
            sounds: {refresh: true},
            foreground: {refresh: true}
        });
    }

    /**
     * Deletes the visionSource created by the refreshVision method.
     */
    endSight() {
        canvas.sight.sources.delete("SSM_SceneDivider");
        canvas.perception.update({
            sight: {refresh: true, forceUpdateFog: true}
        })
    }

    /**
     * Logic to create a new compendium (if necessary)
     * Refreshes the application form.
     */
    async createCompendium() {
        // Update the clicked button as this function may take a moment to process
        const btn = document.getElementById('ssm-sd-submit');
        btn.innerText = game.i18n.localize('SSM.SceneDividerUI.Processing');
        btn.disabled = true;
        // Check if the compendium name chosen exists already
        const packName = this.compName.toLowerCase();
        const pack = game.packs.get(`world.${packName}`);
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
        let points = []
        for (const pt of division.polygonVertexCoordinates) {
            points = [...points, ...pt];
        }
        const poly = new PIXI.Polygon(points);
        const mask = new PIXI.LegacyGraphics();
        mask.beginFill(0x000000);
        mask.drawPolygon(poly);
        mask.endFill();

        const tempContainer = new PIXI.Container();
        const tex = await loadTexture(canvas.scene.data.img);
        let sprite = new PIXI.Sprite(tex);
        tempContainer.addChild(sprite);
        tempContainer.addChild(mask);
        mask.x = division.boundingBox.sceneX;
        mask.y = division.boundingBox.sceneY;
        tempContainer.mask = mask;

        const transform = PIXI.Matrix.IDENTITY.clone();
        transform.scale(1,1);
        const tx = division.boundingBox.sceneX;
        const ty = division.boundingBox.sceneY;
        transform.translate(-tx, -ty);

        const texture = PIXI.RenderTexture.create({
            width: division.boundingBox.width + division.boundingBox.offsetX,
            height: division.boundingBox.height + division.boundingBox.offsetY,
            scaleMode: PIXI.SCALE_MODES.LINEAR,
            resolution: 1
        });

        canvas.app.renderer.render(tempContainer, texture, undefined, transform);

        const image = canvas.app.renderer.extract.base64(new PIXI.Sprite(texture), "image/webp", 1);

        /**
         * Conversion from base64 image to blob found at:
         * https://stackoverflow.com/questions/38658654/how-to-convert-a-base64-string-into-a-file/38659875#38659875
         */
        const pos = image.indexOf(';base64,');
        const b64 = image.substr(pos + 8);

        const imageContent = atob(b64);
        const buffer = new ArrayBuffer(imageContent.length);
        const view = new Uint8Array(buffer);

        for (let n=0; n < imageContent.length; n++) {
            view[n] = imageContent.charCodeAt(n);
        }

        const blob = new Blob([buffer], {type: "image/webp"});

        const fileName = division.subSceneName + ".webp";
        const file = new File([blob], fileName, {type: 'image/webp'});
        const response = await FilePicker.upload("data", this.path, file);
    }

    /**
     * Logic to create a sub-scene in the compendium and add the data from canvas.scene to it.
     */
    async addSubScenesToCompendium(pack) {
        for (const division of this.divisions) {
            // Modifiy data
            const newData = {
                height : division.boundingBox.height + division.boundingBox.offsetY,
                width : division.boundingBox.width + division.boundingBox.offsetX,
                img : this.path + "/" + division.subSceneName + ".webp",
                name : division.subSceneName,
                padding : 0,
                thumb : undefined,
            };   

            // Then create the scene in the pack
            await Scene.create(newData, {pack: pack.collection});
        }
    }

    async cullPlaceablesInPack(pack) {
        for (const scene of pack.contents) {
            // Find the division for this scene...
            const division = this.divisions.filter(d => d.subSceneName === scene.name)[0];
            // Create a PIXI polygon for this div
            // Use to determine if a placeables coordinate is contained within it.
            const poly = generatePixiPolygon(division.polygonVertexCoordinates);

            const wallArray = [];
            for (const wall of canvas.scene.walls) {
                if ( division.instanceWalls.has(wall.id) ) {
                    const d = new WallDocument({
                        c: [    wall.data.c[0] -= division.boundingBox.x,
                                wall.data.c[1] -= division.boundingBox.y,
                                wall.data.c[2] -= division.boundingBox.x,
                                wall.data.c[3] -= division.boundingBox.y
                        ],
                        dir: wall.data.dir,
                        door: wall.data.door,
                        ds: wall.data.ds,
                        light: wall.data.light,
                        move: wall.data.move,
                        sight: wall.data.sight,
                        sound: wall.data.sound
                    }, {parent: scene});
                    wallArray.push(d);
                }
            }

             const walls = wallArray;

            const cullPlaceables = (placeables) => {
                const updateArray = []
                const placeablesCopy = canvas.scene[placeables].toObject();
                for (const placeable of placeablesCopy) {    // is a Map
                    const x = placeable.x - (division.boundingBox.x - division.boundingBox.offsetX);
                    const y = placeable.y - (division.boundingBox.y - division.boundingBox.offsetY);
                    if ( poly.contains(x, y) ) {
                        placeable.x -= division.boundingBox.x,
                        placeable.y -= division.boundingBox.y
                        updateArray.push(placeable);
                    }
                }
                return updateArray;
            }

             const drawings = cullPlaceables("drawings");
             const lights = cullPlaceables("lights");
             const notes = cullPlaceables("notes");
             const sounds = cullPlaceables("sounds");
             const templates = cullPlaceables("templates");
             const tiles = cullPlaceables("tiles");
             const tokens = cullPlaceables("tokens");

             await scene.update({
                walls: walls,
                drawings: drawings,
                lights: lights,
                notes: notes,
                sounds: sounds,
                templates: templates,
                tiles: tiles,
                tokens: tokens
            }, {recursive: false})
        }
    }
}

/** Extension of the core's FilePicker class to do three things:
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