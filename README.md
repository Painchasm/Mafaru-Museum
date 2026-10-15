# The Mafaru Museum

A seaside journey through our friend group's inside jokes. Static site, hosted on GitHub Pages,
edited without code through Pages CMS.

## What's in this folder

- `index.html`, `style.css`, `app.js`: the site itself (no need to touch these)
- `data/`: all the content (memories, travelers, quotes, settings)
- `images/`: all the pictures
- `.pages.yml`: tells Pages CMS which forms to show (keep it in the repo root)

## The areas

- Front page: featured memories hang on a wire in the hero
- The Street (`street`): everyday snapshots on a film strip
- Hall of Fame Cafe (`cafe`): the legends, pinned on the cafe wall
- Seaside Viewpoint (`seaside`): big scenic moments as large prints
- Night Alley (`alley`): secret memories behind a password gate

## Quick troubleshooting

1. Open `https://YOUR-NAME.github.io/REPO/data/exhibits.json` in your browser.
   If you see a 404 page, the `data` folder is not in the repo in the right place.
2. If the site shows a yellow notice at the top, it names the exact file with the problem.
3. A picture shows "Can't find ..."? The path saved in Pages CMS doesn't match a file in `images/`.
4. After saving in Pages CMS, wait 1 to 2 minutes, then hard refresh (Ctrl+Shift+R).
