# Amazon Connect Flow Sync

(Currently only supports downloading flows.)

## Requirements

Requires a Chrome browser to be installed.
Requires NodeJS 12+

## Usage

```bash
export INSTANCE_ID="my-connect-instance" # ID of your Amazon Connect instance (the start of its url)
export USERNAME="cicd_user"              # The username of a user in your Amazon Connect instance that has permissions to export contact flows
export PASSWORD="c1cd_pAssw0rd!"         # The password for that user
export FLOW_FILTER="Sample "             # (optional) sets a name filter that will determine which flows are downloaded
export DOWNLOAD_PATH="./flows"           # (optional) download location for the flow files (defaults to pwd)
export CHROMIUM_PATH="/bin/chrome"       # (optional) a path to a Chrome binary, if it is not on the PATH
node index.js
```