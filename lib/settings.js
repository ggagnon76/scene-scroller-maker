import { ModuleName } from "../ssm-launch.js";
import { getCompendiumPack } from "./functions.js";

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
        compendiumList: this.compendiumList,
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

/** Form application that will be invoked by the settings menu to select a default folder to save images
*/
export class SSM_SelectDefaultImgPath extends FormApplication {
    constructor() {
      super();
      
    }
  
    static get defaultOptions() {
      return mergeObject(super.defaultOptions, {
        width: 500,
        template: `./modules/${ModuleName}/templates/ssm-config-select-img-path.hbs`,
        id: "ssm-settings-select-img-path",
        title: game.i18n.localize('SSM.DefaultImgPathMenu.Title'),
        submitOnChange: true,
        closeOnSubmit: false
      })
    }
  
    getData() {
  
      return {
        current: game.settings.get(ModuleName, "defaultImagePath")
      }
    }
  
    activateListeners(html) {
      super.activateListeners(html);
    }
  
    async _updateObject(event, formData) {

        if ( event.type === "submit") {
            game.settings.set(ModuleName, "defaultImagePath", formData["ssm-path-choice-current"]);
            this.close()
        }
    }
}