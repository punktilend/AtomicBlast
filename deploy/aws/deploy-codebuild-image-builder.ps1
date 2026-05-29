$ErrorActionPreference = "Stop"

$sourceBucketName = aws ssm get-parameter --name /atomic-radius/prod/s3/static_bucket --query "Parameter.Value" --output text
$repositoryUri = aws cloudformation describe-stacks --stack-name atomic-blast-foundation --query "Stacks[0].Outputs[?OutputKey=='ServerRepositoryUri'].OutputValue | [0]" --output text

aws cloudformation deploy `
  --stack-name atomic-blast-codebuild-image `
  --template-file deploy/aws/codebuild-image-builder.yaml `
  --capabilities CAPABILITY_NAMED_IAM `
  --parameter-overrides `
    SourceBucketName=$sourceBucketName `
    RepositoryUri=$repositoryUri

aws cloudformation describe-stacks --stack-name atomic-blast-codebuild-image --query "Stacks[0].Outputs" --output table

