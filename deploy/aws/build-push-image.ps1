param(
  [string]$ImageTag = "aws-prep"
)

$ErrorActionPreference = "Stop"

$repositoryUri = aws cloudformation describe-stacks --stack-name atomic-blast-foundation --query "Stacks[0].Outputs[?OutputKey=='ServerRepositoryUri'].OutputValue | [0]" --output text
if (-not $repositoryUri -or $repositoryUri -eq "None") {
  throw "atomic-blast-foundation is not deployed or did not output ServerRepositoryUri."
}

$accountId = aws sts get-caller-identity --query Account --output text
$region = aws configure get region
if (-not $region) { $region = "us-east-1" }

aws ecr get-login-password --region $region | docker login --username AWS --password-stdin "$accountId.dkr.ecr.$region.amazonaws.com"
docker build -t "${repositoryUri}:${ImageTag}" -f AtomicBlast-Server/Dockerfile AtomicBlast-Server
docker push "${repositoryUri}:${ImageTag}"

Write-Host "Pushed ${repositoryUri}:${ImageTag}"

