import { SSM_SelectDefaultCompendium } from "./lib/forms.js";
import { populateMenuButtons, getCompendiumPack } from "./lib/functions.js";
import { Texture2Polygon } from "./lib/poly_from_texture.js";

// Convenience variable to insert the module name where required
export const ModuleName = "scene-scroller-maker";
// Convenience variable to insert the module title where required
export const ModuleTitle = "Scene Scroller Maker"

Hooks.on('getModuleToolGroups', (controlManager, toolGroup) => {
    populateMenuButtons(toolGroup);
});

Hooks.once('ready', () => {
    game.modules.get(ModuleName).api = Texture2Polygon;

    /**
    game.settings.registerMenu(ModuleName, "defaultImagePathMenu", {
        name: game.i18n.localize("SSM.DefaultImagePath.Name"),
        label: game.i18n.localize("SSM.DefaultImagePath.Label"),
        hint: game.i18n.localize("SSM.DefaultImagePath.Hint"),
        type: String,
        restricted: true
    })
    */

    game.settings.register(ModuleName, "defaultSceneCompendium", {
        scope: "world",
        config: false,
        requiresReload: false,
        type: String,
        default: ""
    })

    const defaultCompendium = game.settings.get(ModuleName, "defaultSceneCompendium");
    // If the compendium set as default was deleted
    if ( !getCompendiumPack(defaultCompendium) ) {
        game.settings.set(ModuleName, "defaultSceneCompendium", "");
    }

    game.settings.registerMenu(ModuleName, "defaultSceneCompendiumMenu", {
        name: game.i18n.localize("SSM.DefaultSceneCompendiumMenu.Name"),
        label: game.i18n.localize("SSM.DefaultSceneCompendiumMenu.Label"),
        hint: game.i18n.localize("SSM.DefaultSceneCompendiumMenu.Hint"),
        type: SSM_SelectDefaultCompendium,
        restricted: true
    })
})
