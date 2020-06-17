# Amazon Connect Flow Sync

* Supports exporting flows from connect to local file system
* Supports uploading flows from local file system to connect
* Will update ARNs when transfering flows across instances. (This includes support for invoked lambda ARNs, including changing the stage name of lambdas deployed using serverless framework)
* Can update encryption IDs and certificates for encrypted user input blocks

## Requirements

Requires NodeJS 11+

## Installation

Permanent install (recommended)
```bash
npm install -g github:infinityworks/amazon-connect-flow-sync

connect-sync [options] <command> <instance_alias>
```

Or for one-off use, invoke without installing:
```bash
npx github:infinityworks/amazon-connect-flow-sync [options] <command> <instance_alias>
```

## Usage Examples


```bash
# Connect to my-dev-connect-app.awsapps.com/connect using username and password
# Export published flows with "sample" in their name and download them to a local directory:
connect-sync -u admin -p admin download my-dev-connect-app -f "sample_" -d ./sample-flows --skip-unpublished

# import these flows back into the same connect instance later. No need to fix any ARNs.
connect-sync -u admin -p admin upload my-dev-connect-app -s "./sample-flows/*.json" --no-arn-fix

# Connect to my-prod-connect-app.awsapps.com/connect (with instance id 12345678-9012-3456-7890-123456789012) using federated login
# (AWS credentials must be set up for a user/role with IAM permissions to GetFederationToken on this instance)
# Import sample flows from dev into this instance. Update lambda names created by serverless framework to prod stage, update encryption certs:
AWS_PROFILE=connect-admin connect-sync -i 12345678-9012-3456-7890-123456789012 upload my-prod-connect-app \
    -s "./sample-flows/*.json" \
    --serverless-stage prod \
    --encryption-id abcdabcd-1111-4444-1111-0123456789ab
    --encryption-cert ./connect-prod.cert.pem
```