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
        this.inWorkDivTitle = ""
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
            isDividing: this.isDividing
        }

        if ( !this.hasImgPath ) {
            returnObj.explanation1 = game.i18n.localize('SSM.SceneDividerUI.Explanation1');
            returnObj.explanation2 = game.i18n.localize('SSM.SceneDividerUI.Explanation2');
            returnObj.explanation3 = game.i18n.localize('SSM.SceneDividerUI.Explanation3');
            return returnObj
        }

        if ( !this.hasCompName ) {
            returnObj.explanation4 = game.i18n.localize('SSM.SceneDividerUI.Explanation4');
            return returnObj
        }

        returnObj.compName = this.compName;

        if ( !this.hasInWorkDivision && !this.hasDivisions ) {
            returnObj.explanation5 = game.i18n.localize('SSM.SceneDividerUI.Explanation5');
            return returnObj
        } 
        
        if ( this.hasInWorkDivision && !this.isDividing ) {
            returnObj.explanation6 = game.i18n.localize('SSM.SceneDividerUI.Explanation6');
            return returnObj
        }

        if ( this.isDividing ) {
            returnObj.explanation7 = game.i18n.localize('SSM.SceneDividerUI.Explanation7');
            returnObj.explanation8 = game.i18n.localize('SSM.SceneDividerUI.Explanation8');
            return returnObj
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

    _launchT2P () {
        const T2P = new Texture2Polygon(this.inWorkDivTitle);
        T2P.generateDrawingPolygon();
        this.divisions.push(T2P);
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
            const fp = new SSM_FilePicker(this, options);
            this.filepickers.push(fp);
            return fp.browse();
          }
}

/** Extension of the core's FilePicker class to do three things:
 *  1) override the get defaultOptions() to use a different template, and
 *  2) create a new variable similar to canUpload() with the 'folder' type restriction removed, and
 *  3) override the getData() method to add the new variable.
 */
 class SSM_FilePicker extends FilePicker {
    constructor(fa, options={}) {
        super(options);

        this.parentFormApplication = fa;
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