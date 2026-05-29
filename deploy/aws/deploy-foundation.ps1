$ErrorActionPreference = "Stop"

$vpcId = aws ssm get-parameter --name /atomic-radius/prod/network/vpc_id --query "Parameter.Value" --output text
$privateSubnetIds = aws ssm get-parameter --name /atomic-radius/prod/network/private_subnet_ids --query "Parameter.Value" --output text
$ecsServiceSecurityGroupId = aws ssm get-parameter --name /atomic-radius/prod/security/ecs_service_security_group_id --query "Parameter.Value" --output text

aws cloudformation deploy `
  --stack-name atomic-blast-foundation `
  --template-file deploy/aws/foundation.yaml `
  --capabilities CAPABILITY_NAMED_IAM `
  --parameter-overrides `
    VpcId=$vpcId `
    PrivateSubnetIds=$privateSubnetIds `
    EcsServiceSecurityGroupId=$ecsServiceSecurityGroupId

aws cloudformation describe-stacks --stack-name atomic-blast-foundation --query "Stacks[0].Outputs" --output table

