import { ModuleName } from "../ssm-launch.js";
import { Texture2Polygon } from "./poly_from_texture.js";

export class SSM_SceneDivider extends FormApplication {
    constructor() {
        super();

        this.hasImgPath = false;
        this.hasCompName = false;
        this.path = "";
        this.compName = "";
        this.hasDivisions = false;
        this.divisions = [];
        this.isDividing = false;
        this.hasInWorkDivision = false;
        this.inWorkDivTitle = "";
        this.vision = undefined;
        this.refreshTime = undefined;
        this.cursorLoc = {};
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
    }

    _updateObject(event, formData) {
        // Logic when form is submitted.
    }

    async close(options={}) {
        if ( this.divisions.length ) {
            const drwIDS = [];
            for (const div of this.divisions) {
                drwIDS.push(div.drawingID);
            }

            canvas.scene.deleteEmbeddedDocuments("Drawing", drwIDS);
        }

        this.endSight();
        libWrapper.unregister_all(ModuleName);

        return super.close(options);
    }

    async _launchT2P () {
        const T2P = new Texture2Polygon(this.inWorkDivTitle);
        await T2P.generateDrawingPolygon();

        libWrapper.unregister_all(ModuleName);

        this.divisions.push(T2P);
        this.hasDivisions = true;
        this.hasInWorkDivision = false;
        this.isDividing = false;
        this.inWorkDivTitle = "";
        this.render(false, {width: 800, height: "auto"});
    }

    _createDiv() {
        if ( this.hasInWorkDivision ) {
            ui.notifications.info(game.i18n.localize('SSM.SceneDividerUI.ErrorDivNotFinish'));
            return;
        }
        this.hasInWorkDivision = true;
        this.render(false, {height: "auto"})
    }

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
            // Do nothing.
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

    refreshVision() {
 
        this.vision = new VisionSource(this);
        const d = canvas.dimensions;
        const r = d.sceneRect.width > d.sceneRect.height ? d.sceneRect.width : d.sceneRect.height

        const visionData = {
            x: this.cursorLoc.x,
            y: this.cursorLoc.y,
            dim: 0,
            bright: r,
            angle: 360,
            rotation: 0
        }

        this.vision.initialize(visionData)

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

    endSight() {
        canvas.sight.sources.delete("SSM_SceneDivider");
        canvas.perception.update({
            sight: {refresh: true, forceUpdateFog: true}
        })
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