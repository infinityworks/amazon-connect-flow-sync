# Amazon Connect Flow Sync

* Supports exporting flows from connect to local file system
* Supports uploading flows from local file system to connect
* Will update ARNs when transfering flows across instances. (This includes support for invoked lambda ARNs, including changing the stage name of lambdas deployed using serverless framework)
* Can update encryption IDs and certificates for encrypted user input blocks

## Requirements

Requires NodeJS 11+

## Installation

Permanent install
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
# Import sample flows from dev into this instance. Update lambda names created by serverless framework to prod stage, update encryption certs, create any flows that don't exist:
AWS_PROFILE=connect-admin connect-sync -i 12345678-9012-3456-7890-123456789012 upload my-prod-connect-app \
    -s "./sample-flows/*.json" \
    --serverless-stage prod \
    --encryption-id abcdabcd-1111-4444-1111-0123456789ab \
    --encryption-cert ./connect-prod.cert.pem \
    --create-missing
```

### Service Roles

When using fedarated login, there must be a user created in connect with a username matching the userID attached to the IAM role that will be used to execute the command. Where that userID comes from will depend on the principal of the role. The names map to the `aws:userid` column [in this table](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_variables.html#principaltable), however where the userID contains a colon, only the part after the colon is used.

For instance, when using a build pipeline, you might assume a role like this:
```
aws sts assume-role --role-arn "$ROLE_ARN" --role-session-name mydeploymentpipeline
```
where `$ROLE_ARN` is an IAM role with permission to `GetFederationToken` on the instance.

When run under this role, the CLI will try to log in as the user `mydeploymentpipeline`. A user should be set up in connect with this username that has permission to view, edit and publish flows.

The CLI outputs the name of the user it is trying to log in as when it runs like this:
```
🔑 Using AWS federated login for mydeploymentpipeline
```