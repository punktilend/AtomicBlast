param(
  [string]$ImageTag = "aws-prep",
  [int]$DesiredCount = 0
)

$ErrorActionPreference = "Stop"

$vpcId = aws ssm get-parameter --name /atomic-radius/prod/network/vpc_id --query "Parameter.Value" --output text
$publicSubnetIds = aws ssm get-parameter --name /atomic-radius/prod/network/public_subnet_ids --query "Parameter.Value" --output text
$ecsServiceSecurityGroupId = aws ssm get-parameter --name /atomic-radius/prod/security/ecs_service_security_group_id --query "Parameter.Value" --output text
$executionRoleArn = aws ssm get-parameter --name /atomic-radius/prod/iam/ecs_task_execution_role_arn --query "Parameter.Value" --output text
$taskRoleArn = aws ssm get-parameter --name /atomic-radius/prod/iam/ecs_task_role_arn --query "Parameter.Value" --output text
$repositoryUri = aws cloudformation describe-stacks --stack-name atomic-blast-foundation --query "Stacks[0].Outputs[?OutputKey=='ServerRepositoryUri'].OutputValue | [0]" --output text
$efsFileSystemId = aws cloudformation describe-stacks --stack-name atomic-blast-foundation --query "Stacks[0].Outputs[?OutputKey=='StateFileSystemId'].OutputValue | [0]" --output text
$efsAccessPointId = aws cloudformation describe-stacks --stack-name atomic-blast-foundation --query "Stacks[0].Outputs[?OutputKey=='StateAccessPointId'].OutputValue | [0]" --output text
$httpsListenerArn = aws elbv2 describe-listeners `
  --load-balancer-arn (aws cloudformation describe-stacks --stack-name atomic-radius-edge-alb --query "Stacks[0].Outputs[?OutputKey=='LoadBalancerArn'].OutputValue | [0]" --output text) `
  --query "Listeners[?Port==``443``].ListenerArn | [0]" `
  --output text

aws cloudformation deploy `
  --stack-name atomic-blast-service `
  --template-file deploy/aws/service.yaml `
  --capabilities CAPABILITY_NAMED_IAM `
  --parameter-overrides `
    ImageTag=$ImageTag `
    DesiredCount=$DesiredCount `
    VpcId=$vpcId `
    PublicSubnetIds=$publicSubnetIds `
    EcsServiceSecurityGroupId=$ecsServiceSecurityGroupId `
    EcsTaskExecutionRoleArn=$executionRoleArn `
    EcsTaskRoleArn=$taskRoleArn `
    HttpsListenerArn=$httpsListenerArn `
    RepositoryUri=$repositoryUri `
    EfsFileSystemId=$efsFileSystemId `
    EfsAccessPointId=$efsAccessPointId

aws cloudformation describe-stacks --stack-name atomic-blast-service --query "Stacks[0].Outputs" --output table

