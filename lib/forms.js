import { ModuleName } from "../ssm-launch.js";
import { hasImgPath} from "./functions.js";

/** Extension of the core's FilePicker class to allow the creation of folders by:
 *  1) override the get defaultOptions() to use a different template, and
 *  2) create a new variable similar to canUpload() with the 'folder' type restriction removed, and
 *  3) override the getData() method to add the new variable.
 */
export class SSM_FilePicker extends FilePicker {
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

/**  FormApplication launched when user wants to convert an image in a folder to .webp format. */
export class SSM_ConvertImage extends FormApplication {
    constructor(resolve, {batch = false, path = null, useDefault = false}={}) {
        super();
        this.result = resolve;
        this.batch = batch;
        this.compression = 0.9;
        this.path = path === "null" ? "" : path;
        this.useDefault = useDefault;
        this.currentStep = 1;
        this.currentRadio = useDefault ? "1" : "2";
        this.fp = new FilePicker({
            type: "image"
        })
        this._startsWithPath(path);
    }

    static get defaultOptions() {
        return mergeObject(super.defaultOptions, {
            width: 500,
            template: `modules/${ModuleName}/templates/ssm-convert-image.hbs`,
            id: "ssm-convert-image",
            title: game.i18n.localize('SSM.ConvertImageUI.Title'),
            submitOnChange: true,
            closeOnSubmit: false
        })
    }

    async getData() {
        return {
            useDefault: this.useDefault,
            step1: this.currentStep === 1 ? true : false,
            step2: this.currentStep === 2 ? true : false,
            compression: this.compression,
            isBatch: this.batch,
            path: this.path,
            saveLocation : this.fp.sources[this.fp.activeSource].target,
            hasDefaultImgPath : await hasImgPath(),
            imgRadio1: this.currentRadio === "1" ? true : false,
            imgRadio2: this.currentRadio === "2" ? true : false
        }
    }

    _startsWithPath(path) {
        if ( path === "null" ) return;
        this.fp.request = path;
        const [source, target] = this.fp._inferCurrentDirectory(path);
        this.fp.activeSource = source;
        this.fp.sources[source].target = target === "" ? game.settings.get(ModuleName, "defaultImagePath") : target;
    }

    _updateObject(event, formData) {

        if ( event.type === "change" ) {
            if ( 'ssm-ciui-compression' in formData ) {
                this.compression = formData["ssm-ciui-compression"];
            }
            if ( 'imagePath' in formData ) {
                this.path = formData.imagePath;
                const [source, target] = this.fp._inferCurrentDirectory(this.path);
                this.fp.sources[source].target = target;
            }
            if ( 'folderPath' in formData ) {
                this.path = formData.folderPath;
                this.fp.request = formData.folderPath
                this.fp.sources[this.fp.activeSource].target = formData.folderPath;
            }
            if ( 'ssm-ciui-path' in formData ) {
                if ( formData["ssm-ciui-path"] === "1" ) {
                    this.currentRadio = "1";
                    const [source, target] = this.fp._inferCurrentDirectory(game.settings.get(ModuleName, "defaultImagePath"));
                    this.activeSource = source
                    this.fp.sources[source].target = target;
                } else {
                    this.currentRadio = "2";
                    const [source, target] = this.fp._inferCurrentDirectory(this.path);
                    this.fp.activeSource = source;
                    this.fp.sources[source].target = target;
                }
            }
            this.render(false)
        }

        if ( event.type === "submit" ) {
            if ( event.submitter.id === "ssm-ciui-stp1-stp2") {
                if ( formData.imagePath ) this.fp.request = formData.imagePath;
                this.currentStep = 2;
                this.render(false, {height: "auto"});
            }
            if ( event.submitter.id === "ssm-ciui-stp2-stp1") {
                this.currentStep = 1;
                this.render(false, {height: "auto"});
            }
            if ( event.submitter.id === "ssm-ciui-stp2-submit" ) {
                this.close();
                return this.result({
                    fp: this.fp,
                    compression: this.compression
                })
            }
        }
    }
}

/** FormApplication launched when user wants to resize an image in a folder. */
export class SSM_ResizeImage extends FormApplication {
    constructor(resolve, tile, options) {
        super({}, options);
        this.result = resolve;
        this.tile = tile.object;
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

/** FormApplication launched when user wants to crop portions of an image in a folder. */
export class SSM_CropImage extends FormApplication {
    constructor(resolve) {
        super();
        this.result = resolve;
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

// A confirmation dialog that displays the same styling as the rest of Scene Scroller Maker UI elements.
export class SSM_ConfirmationDialog extends FormApplication {
    constructor(title, content, resolve) {
        super();
        this.appTitle = title;
        this.content = content;
        this.result = resolve;
    }

    static get defaultOptions() {
        return mergeObject(super.defaultOptions, {
          width: 400,
          template: `./modules/${ModuleName}/templates/ssm-confirm.hbs`,
          id: "ssm-confirmation-dialog",
          title: this.appTitle,
          submitOnChange: false,
          closeOnSubmit: true
        })
      }

      getData() {
        return {
          content: this.content
        }
      }
    
      async _updateObject(event, formData) {
        const val = event.submitter.dataset.bool === "true" ? true : false;
        return this.result(val)
      }
}