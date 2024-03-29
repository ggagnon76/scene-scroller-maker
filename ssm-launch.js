import { SSM_SelectDefaultCompendium, SSM_SelectDefaultImgPath } from "./lib/settings.js";
import { populateMenuButtons, getCompendiumPack, processFlaggedDivisionData } from "./lib/functions.js";

// Convenience variable to insert the module name where required
export const ModuleName = "scene-scroller-maker";
// Convenience variable to insert the module title where required
export const ModuleTitle = "Scene Scroller Maker"

Hooks.once('init', () => {

    game.modules.get(ModuleName).API = {processFlaggedDivisionData};

    game.settings.register(ModuleName, "defaultImagePath", {
        scope: "world",
        config: false,
        requiresReload: false,
        type: String,
        default: ""
    })

    game.settings.registerMenu(ModuleName, "defaultImagePathMenu", {
        name: game.i18n.localize("SSM.DefaultImgPathMenu.Name"),
        label: game.i18n.localize("SSM.DefaultImgPathMenu.Label"),
        hint: game.i18n.localize("SSM.DefaultImgPathMenu.Hint"),
        type: SSM_SelectDefaultImgPath,
        restricted: true
    })

    game.settings.register(ModuleName, "defaultSceneCompendium", {
        scope: "world",
        config: false,
        requiresReload: false,
        type: String,
        default: ""
    })

    game.settings.registerMenu(ModuleName, "defaultSceneCompendiumMenu", {
        name: game.i18n.localize("SSM.DefaultSceneCompendiumMenu.Name"),
        label: game.i18n.localize("SSM.DefaultSceneCompendiumMenu.Label"),
        hint: game.i18n.localize("SSM.DefaultSceneCompendiumMenu.Hint"),
        type: SSM_SelectDefaultCompendium,
        restricted: true
    })

    game.settings.register(ModuleName, "SSM_MenuToggle", {
        name: game.i18n.localize("SSM.MenuToggle"),
        hint: game.i18n.localize("SSM.MenuToggleHint"),
        scope: "client",
        config: false,
        requiresReload: false,
        type: Boolean,
        default: true,
        restricted: true,
        onChange: () => Hooks.call('reloadModuleButtons')
    })
})

Hooks.once('ready', () => {

    const defaultCompendium = game.settings.get(ModuleName, "defaultSceneCompendium");
    // If the compendium set as default was deleted
    if ( !getCompendiumPack(defaultCompendium) ) {
        game.settings.set(ModuleName, "defaultSceneCompendium", "");
    }

    if ( !game.user.isGM ) {
        game.settings.set(ModuleName, "SSM_MenuToggle", false)
    }
})

Hooks.on('getModuleToolGroups', (controlManager, toolGroup) => {
    populateMenuButtons(toolGroup);
});

Hooks.on('getSceneNavigationContext', (html, contextOptions) => {
    contextOptions.push({
        name: 'SSM.ToggleSSM',
        icon: "<i class='fas fa-puzzle-piece'></i>",
        condition: li => game.user.isGM && game.scenes.get(li.data("sceneId")).active,
        callback: () => {
            if ( !game.user.isGM ) {
                game.settings.set(ModuleName, "SSM_MenuToggle", false);
            } else {
                const setting = game.settings.get(ModuleName, "SSM_MenuToggle")
                game.settings.set(ModuleName, "SSM_MenuToggle", !setting);
            }
        }
    })
})
