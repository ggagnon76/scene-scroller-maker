import { ModuleName } from "../ssm-launch.js";

export class SSM_SceneDivider extends FormApplication {
    constructor() {
        super();

        this.hasPath = false;
        this.hasCompName = false;
        this.path = "";
        this.compName = "";
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
            hasPath: this.hasPath,
            path: this.path,
            hasCompName: this.hasCompName
        }

        if ( !this.hasImgPath ) {
            returnObj.explanation1 = game.i18n.localize('SSM.SceneDividerUI.Explanation1');
            returnObj.explanation2 = game.i18n.localize('SSM.SceneDividerUI.Explanation2');
            returnObj.explanation3 = game.i18n.localize('SSM.SceneDividerUI.Explanation3'); 
        }

        if ( !this.hasCompName && this.hasPath ) {
            returnObj.explanation4 = game.i18n.localize('SSM.SceneDividerUI.Explanation4');
        }

        if ( this.hasCompName ) {
            returnObj.compName = this.compName;
            returnObj.explanation5 = game.i18n.localize('SSM.SceneDividerUI.Explanation5');
        }

        return returnObj
    }

    activateListeners(html) {
        super.activateListeners(html);

        html.find("#comp-continue").click(this._compContinue.bind(this));
    }

    _updateObject(event, formData) {
        // Logic when form is submitted.
    }

    _compContinue() {
        const isText = document.getElementById("comp-input").value;
        if ( isText !== "" ) {
            this.compName = isText;
            this.hasCompName = true;
        }
        this.render();
    }

    _onSelectFile(path, filepicker) {
        this.path = path;
        this.hasPath = true;
        this.render();
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