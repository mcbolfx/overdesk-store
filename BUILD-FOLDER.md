# Build the exact Folder component into the page

Put these in one folder:  Folder.jsx, Folder.css (your exact files), folder-entry.jsx, index.html

    npm init -y
    npm i react react-dom esbuild
    npx esbuild folder-entry.jsx --bundle --minify --format=iife --jsx=automatic \
      --define:process.env.NODE_ENV='"production"' --outfile=folder-bundle.js

This creates folder-bundle.js and folder-bundle.css. Upload them next to index.html.
If they are missing, the page automatically shows the simple CSS folder instead.
