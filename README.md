# bplus🤷🏻‍♂️ Search  

### Local LLM powered private search
---
- SearXNG
- No MCP needed, custom backend, low context yayyyy
- Setup SearXNG without MCP step - [Easy Setup](https://github.com/mrhappynice/lmstudio-dev/tree/main/easy-searx-mcp)
- Run LM Studio, Ollama, etc(correct port and creds in .env)
- dl
  - ```sh
    git clone https://github.com/mrhappynice/bplus-search.git && cd bplus-search
    ```
- run: 
  - ```sh
    npm install
    ```
  - ```sh
    npm run
    ```
  - connect to frontend and search, loser.. :)
- dev notes, install sea builder junk:
   - ```sh
     npm i -D esbuild postject
     ```
- Build it:
  - ```sh
    chmod +x build-sea.sh
    ./build-sea.sh server.js my-app
    ```
- Portable exec - you need the better-sqlite3.node file in ```bplus-search/node_modules/better-sqlite3/build/Release/better-sqlite3.node```
  - You just need the ```my-app``` executable with the ```node_modules``` folder

