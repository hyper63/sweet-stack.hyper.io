dev:
	@deno run --allow-net --allow-read --allow-env --import-map=./import_map.json --watch src/server.js

test:
	@deno fmt src && deno lint src && deno test src

build:
	@deno bundle --import-map import_map.json --no-check=remote ./src/server.js bundle.js