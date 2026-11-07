# Assets

| File | Source | Author | Licence |
| ---- | ------ | ------ | ------- |
| `data/hand/bones.svg` | [202110 Anterior view of bones of right hand.svg](https://commons.wikimedia.org/wiki/File:202110_Anterior_view_of_bones_of_right_hand.svg) (Wikimedia Commons) | DataBase Center for Life Science (DBCLS) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `data/hand/muscles.svg` | Background: the same DBCLS drawing as above. Muscles: drawn for this project | DBCLS (bones); MyoOsteo (muscles) | Bones CC BY 4.0; muscle shapes CC0 1.0 |

## Changes made to `bones.svg`

The original drawing was modified: each bone group got an `id` and a
`structure` / `context` class, Adobe Illustrator metadata was removed, its
CSS classes were renamed to `dbcls-st0`…`dbcls-st7`, and the view box was
cropped. The drawing itself is unchanged. The attribution is also kept in a
comment at the top of the file.

## About `muscles.svg`

No openly licensed drawing with each hand muscle as a separate shape was
found (the CC0 "Wrist and hand deeper palmar dissection" on Commons groups its
shapes by colour, not by muscle). So the muscle layer reuses the DBCLS bone
drawing, faded, as background (ids removed), and adds simple muscle shapes
drawn from each muscle's origin to its insertion. They are schematic, not
illustrations of real muscle shape.

## Replacing an image

Give each quiz shape (or group of shapes) the `id` listed as `svgId` in the
layer's JSON file and the class `structure`. Add a row to the table above
with the source URL, author and licence; CC BY and CC BY-SA require this
attribution.
