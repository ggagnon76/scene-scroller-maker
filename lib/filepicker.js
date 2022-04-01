import { ModuleName } from "../ssm-launch.js";

/** Extension of the core's FilePicker class to do four things:
 *  1) override the get defaultOptions() to use a different template, and
 *  2) create a new variable similar to canUpload() with the 'folder' type restriction removed, and
 *  3) override the getData() method to add the new variable, and
 *  4) override the _onSelectFile() method of FormApplication to execute algorithms when the user
 *     selects a directory from the FilerPicker.
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
            filters: [{inputSelector: 'input[name="filter"]', contentSelector: ".filepicker-body"}]
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
        const data = super.getData(options);
        data.canCreateFolders = this.canCreateFolders;

        return data;
    }

    _onSelectFile(...args) {
        debugger;
        // TODO : Assign the path to the Scene Divider FormApplication
        // TODO : Flip a boolean now that the folder has been chosen
        // TODO : Re-render the Scene Divider FormApplication.
    }
}