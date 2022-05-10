import { ModuleName, ModuleTitle } from "../ssm-launch.js";
import { SSM_SceneDivider } from "./forms.js";

/** A wrapper function that works with the Foundryvtt-devMode module to output debugging info
 *  to the console.log, when a debugging boolean is activated in module settings.
 *  Or the code can pass TRUE to the force argument to output to console.log regardless of the debugging boolean.
 *  @param {Boolean}    force   - A manual bypass to force output regardless of the debugging boolean
 *  @param {}           args    - The content to be output to console.log
 *  @return {void}
 */
 export function log(force, content) {
    try {
        const isDebugging = game.modules.get('_dev-mode')?.api?.getPackageDebugValue(ModuleName);

        if ( isDebugging ) {
            console.log(ModuleTitle,  " debugging | ", ...content);
        } else if ( force ) {
            console.log(ModuleTitle, " | ", ...content)
        }
    } catch (e) {}
}

/** This function populates the menu buttons.  See getModuleToolGroups hook.
 *  @param {Object}     - toolGroup
 *  @return {void}
 */
export function populateMenuButtons(toolGroup) {
    toolGroup.push({
        name: game.i18n.localize('SSM.MenuButtons.SceneDivider.name'),
        icon: "<i class='fas fa-puzzle-piece'></i>",
        title: game.i18n.localize('SSM.MenuButtons.SceneDivider.title'),
        onClick: spawnDividerForm,
        button: true
    },
        {
        name: game.i18n.localize('SSM.MenuButtons.TileNudge.name'),
        icon: "<i class='fas fa-arrows-alt'></i>",
        title: game.i18n.localize('SSM.MenuButtons.TileNudge.title'),
        button: false,
        tools:  [{
                    name: game.i18n.localize('SSM.MenuButtons.Tools.NudgeUp.name'),
                    title: game.i18n.localize('SSM.MenuButtons.Tools.NudgeUp.title'),
                    icon: "<i class='fas fa-arrow-up'></i>",
                    onClick: nudgeTileUP,
                    button: true
                },
                {
                    name: game.i18n.localize('SSM.MenuButtons.Tools.NudgeLeft.name'),
                    title: game.i18n.localize('SSM.MenuButtons.Tools.NudgeLeft.title'),
                    icon: "<i class='fas fa-arrow-left'></i>",
                    onClick: nudgeTileLEFT,
                    button: true
                },
                {
                    name: game.i18n.localize('SSM.MenuButtons.Tools.NudgeRight.name'),
                    title: game.i18n.localize('SSM.MenuButtons.Tools.NudgeRight.title'),
                    icon: "<i class='fas fa-arrow-right'></i>",
                    onClick: nudgeTileRIGHT,
                    button: true
                },
                {
                    name: game.i18n.localize('SSM.MenuButtons.Tools.NudgeDown.name'),
                    title: game.i18n.localize('SSM.MenuButtons.Tools.NudgeDown.title'),
                    icon: "<i class='fas fa-arrow-down'></i>",
                    onClick: nudgeTileDOWN,
                    button: true
                }]
    },
    {
        name: game.i18n.localize('SSM.MenuButtons.CreateLinks.name'),
        title: game.i18n.localize('SSM.MenuButtons.CreateLinks.title'),
        icon: "<i class='fas fa-link'></i>",
        button: true,
        onClick: linkScenes
    })
}

/** Returns a compendium scene document when given a pack name and scene name
 * @param {string}  pack    - The name of the compendium pack
 * @param {string}  scene   - The name of the scene in the above compendium pack
 * @returns {object}        - SceneDocument?
 */
 export async function getSource(pack, scene) {
    const compndm = game.packs.filter(p => p.title === pack)[0];
    const clctn = compndm.collection;
    const scn_id = compndm.index.getName(scene)._id;
    const uuid = `Compendium.${clctn}.${scn_id}`;
    const source = await fromUuid(uuid);
    return source;
}

const debouncedTileTranslation = foundry.utils.debounce((updates) => {
    canvas.scene.updateEmbeddedDocuments("Tile", updates);
    log(false, "updateEmbeddedDocuments for Tile translation submitted to server.");
}, 3000);

function spawnDividerForm() {
    new SSM_SceneDivider({height: "auto"}).render(true);
}

/** A function to move selected tiles by a vector, per button press.
 *  Debounces the final update by 3 seconds to not spam the server.
 *  @param {object}     vector      - An object vector to represent the translation, ex: {x: 100, y: -200}  ie:100 right, 200 up
 *  @returns {void}
 */
function nudge(vector) {
    const tiles = canvas.background.controlled;
    if (!tiles.length) return
    const updates = [];
    for (const tile of tiles) {
        tile.position.set(tile.position._x + vector.x, tile.position._y + vector.y);
        // Have to do the following so the tile doesn't jitter when clicking elsewhere in the scene.
        tile.data.x = tile.data._source.x += vector.x;
        tile.data.y = tile.data._source.y += vector.y;
        const updateObj = {
            _id: tile.id,
            x: tile.position._x,
            y: tile.position._y
        }
        updates.push(updateObj);
    }
    debouncedTileTranslation(updates);
}

/** Invokes the nudge function, and sets the vector to +1 in y direction (down) 
 *  @returns {void}
*/
function nudgeTileDOWN() {
    nudge({x: 0, y: 1});
}

/** Invokes the nudge function, and sets the vector to -1 in x direction (left) 
 *  @returns {void}
*/
function nudgeTileLEFT() {
    nudge({x: -1, y: 0});
}

/** Invokes the nudge function, and sets the vector to +1 in x direction (right) 
 *  @returns {void}
*/
function nudgeTileRIGHT() {
    nudge({x: 1, y: 0});
}

/** Invokes the nudge function, and sets the vector to -1 in y direction (up) 
 *  @returns {void}
*/
function nudgeTileUP() {
    nudge({x: 0, y: -1});
}

/** Insert data into source flags to be used the Scene Scroller module.*/
async function linkScenes() {
    // Works by gathering information from selected tiles in the scene.
    const tiles = canvas.background.controlled;
    // Only allow 2 selected tiles at a time.
    if (tiles.length !== 2) {
        ui.notifications.error("Two tiles must be selected.")
        return;
    }

    // Flag data required for each source scene.  So iterate once per tile
    for (const tile of tiles) {
        // The UUID for the selected tile will have been added as flag data by Scene Tiler
        const tileUUID = tile.document.getFlag("scene-tiler", "scene");
        // Obtain the UUID object, in this case a compendium scene
        const tileSource = await fromUuid(tileUUID);
        let sceneFlagData = {};
        // First check to see if the source already has data stored in flags
        if (tileSource.data.flags.hasOwnProperty(ModuleName)) {
            sceneFlagData = tileSource.getFlag(ModuleName, "sceneScrollerTilerFlags");
        } 
        // if not, grab a data object from the schema defined in the Scene Scroller class.
        // This data goes into the compendium scene flags.
        else {
            sceneFlagData = foundry.utils.deepClone(game.modules.get("scene-scroller").api.sceneScrollerTilerFlags);
        }
        // Get a data object from the schema defined in the Scene Scroller class
        // This data goes into the LinkedTiles array that will be stored in the compendium scene flags.
        // When Scene Scroller creates a sub-scene, that data will then be attached to the Scene Tiler tile.
        const sceneTileLinks = foundry.utils.deepClone(game.modules.get("scene-scroller").api.sceneScrollerTileLinks);

        const tile1 = tile.id === tiles[0].id ? tiles[0] : tiles[1];
        const tile2 = tile.id === tiles[0].id ? tiles[1] : tiles[0];

        // Fill out the data that will be saved to the tile created by Scene Tiler.
        sceneTileLinks.SceneUUID = tile2.document.getFlag("scene-tiler", "scene");
        sceneTileLinks.Vector = {x: tile1.data.x - tile2.data.x, y: tile1.data.y - tile2.data.y};

        // Check to see if the compendium scene already has this data?
        const isExists = sceneFlagData.LinkedTiles.filter(d => d.SceneUUID === tileUUID);
        // If the compendium scene DOES have this data in the array, replace it?
        // TO-DO:  I DON'T THINK THIS IS WORKING... NEEDS TESTING.
        if (isExists.length) {
            const index = sceneFlagData.LinkedTiles.indexOf(isExists[0]);
            if (index !== -1) {
                sceneFlagData.LinkedTiles[index] = sceneTileLinks;
            }
        } 
        // If it doesn't have the data already, then add it to the array.
        else sceneFlagData.LinkedTiles.push(sceneTileLinks)

        // Commit the data to the compendium scene.
        await tileSource.setFlag(ModuleName, "sceneScrollerTilerFlags", sceneFlagData);
    }
    ui.notifications.info("Links saved to scenes flags.")
}

/**
 * A confirmation dialog mostly used when debugging is turned on.
 * @param {string} title
 * @param {string} content
 * @returns {promise}
 */
export async function confirmDialog(title, content) {
    return await Dialog.confirm({
        title: title,
        content: content,
        yes: () => {return true},
        no: () => {return false}
    })
}

export function generatePixiPolygon(vertexCoords) {
    let points = [];
    for (const pt of vertexCoords) {
        points = [...points, ...pt];
    }
    return new PIXI.Polygon(points);
}