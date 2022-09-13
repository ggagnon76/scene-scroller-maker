# scene-scroller-maker
Tools to modify or divide scenes and images.

# V1.0
The v1.0 release provides a set of 7 tools, grouped into two categories, that allow the conversion or modification of images OR the manipulation and modification of complete scenes.

This module is not intended to be used or enabled in a gaming session.  This is intended to be a game prep module, therefore performance is not a driving factor.

There is one module dependency: lib-df-buttons.  This dependency creates a moveable/dockable set of buttons.  In the images and screenshots provided in this document, the buttons have been docked in the top right corner of the canvas.  Note, there is one limitation of this dependency that I hope will be removed when/if a bug report I submitted has been resolved:  **In order for the buttons to work, there must be an active scene.**

## Modification of images group
The first group allows the conversion of image files that are accessible and compatible with Foundry into the recommended WEBP format.  This group also provides the functionality to resize an image (change the width and/or height), OR to crop an image (including strange shapes).

The conversion is performed by the PIXIJS engine built into Foundry.  Be aware the conversion can take some time to complete.

### Convert image to WEBP
This first feature will simply convert an image file that is accessible and compatible with Foundry into the WEBP format.  A dialog will open requesting the path and file to be converted, along with a slider to set the compression ratio.  If you do not have any experience with WEBP compression, a good baseline is to set it to 0.88.  This will significantly reduce the image size while maintaining good quality.  If the image is already compressed and shows some loss of quality, converting it to WEBP will accumulate more quality loss.  If possible, convert the original high quality file.

### Convert an entire folder of images to WEBP
This second feature allows you to select a folder instead of an image file, and any image files that are compatible with Foundry will be converted into the WEBP format.  The same compression quality selection from the dialog will be applied to all the images being converted.  Make sure the images being converted are as original and lossless as possible.

Converting each image can take a moment, so batching an entire folder can take an underterminate amount of time.

### Resize image
This feature will temporarily create a new scene with the image as a tile.  Drag the tile handler or type in the width and/or height in the dialog to choose the new width.  When submitting the dialog, the temporary scene will be removed and a new file will be created in WEBP format at the selected size.

## Crop image
This feature will temporarily create a new scene with the image as a background.  You will then be prompted to draw shapes (ellipses, rectangles or polygons) on the background to highlight what parts of the image to keep.  

NOTE:  The drawing shapes must overlap each other to form a 'chain' of shapes from the first to last.  If you have two groups of overlapping shapes with a gap between the groups, one of the groups will be discarded.

Upon submission of the dialog, the temporary scene will be removed and a new file will be created in WEBP format, resized to fit the cropped area, with transparency surrounding the areas that were not covered with the drawing shapes.

## Modification of a Scene
This second group allows the conversion or division of a scene.  The scene can be completed, ie: has walls, lights, sounds, tiles, templates, etc...

### Convert background (& foreground)
Clicking this button will convert the images for the background and foreground to WEBP and replace them in the scene automatically.

### Resize scene
Similar to the resize image feature, this will create a temporary scene with the background as a tile.  You can resize the image/tile using the tile frame, or enter the width and/or height in the dialog.  When the dialog is submitted, the temporary scene will be removed and this module will create a duplicate scene at the resized dimensions, then it will scale all placeables too!

NOTE:  If the image width to height ratio is not maintained, the module will choose the smallest change to define the radius of light and sound sources.  It is not possible to make the area of coverage for a light or sound into an ellipse.

NOTE:  The foreground will also be automatically resized, however this module will not create a new image file.  It will let Foundry resize the image to fit the scene, which generates a warning message by Foundry Core.  It was decided the warning message is an acceptable alternative to creating more image files in the data folders.

### Divide a scene
This is a tool that was created for the Scene-Scroller module, which may never be released.  However, it offers an interesting way to segment an already existing scene (with all placeables) into bite sized pieces.  Those pieces are stored into a new scene compendium as their own individual scenes, which will be called 'sub-scenes' going forward. 

A module like Scene Tiler (needs to be updated to V10) can drag and drop these sub-scenes onto a scene to build up as many parts of the original as required.  Or each sub-scene can be run as individual scenes on their own.

#### How to use?
The dialog that is presented will provide some basic instruction.  The basic sequence is:
1) Select a folder where the tool will save all the image pieces for the new sub-scenes,
2) Select a compendium name where the sub-scenes will be saved,
3) Create a new division (this becomes a sub-scene) and provide it with a name,
4) Explore the area you want the division to encompass by left-clicking and dragging the mouse,
5) Repeat step 4 as often as necessary,
6) Submit the dialog to create the compendium containing all the sub-scenes.

NOTE:
- If you enter a compendium name that already exists, the module will create the sub-scenes in the existing compendium.
- The name of the division becomes the name of the sub-scene in the compendium.
- When exploring a single or many divisions/sub-scenes, you can't circle around the scene and leave a hole in the center.  If you do so, the last division/sub-scene will fill the hole.  Start by defining the middle, where the hole would have been, then finish with the rest of the scene.
- The left-click-drag functionality to explore the areas work using Foundry walls (of any type).  You must outline the desired area with walls for this feature to succeed.
- The left-click-drag functionality has one intermittent bug that I haven't been able to reproduce reliably:  Sometimes when click-dragging, nothing happens...  I found that losing focus of the browser and regaining focus of the browser allowed the exploration functionality to start working.  Big kudos if anyone figures out what is going on...

