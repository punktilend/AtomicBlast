param(
  [string]$ImageTag = "aws-prep"
)

$ErrorActionPreference = "Stop"

$sourceBucketName = aws ssm get-parameter --name /atomic-radius/prod/s3/static_bucket --query "Parameter.Value" --output text
$projectName = aws cloudformation describe-stacks --stack-name atomic-blast-codebuild-image --query "Stacks[0].Outputs[?OutputKey=='ProjectName'].OutputValue | [0]" --output text
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("atomicblast-codebuild-" + [System.Guid]::NewGuid().ToString("N"))
$sourceZip = Join-Path $tempRoot "source.zip"

New-Item -ItemType Directory -Path $tempRoot | Out-Null
try {
  New-Item -ItemType Directory -Path (Join-Path $tempRoot "AtomicBlast-Server") | Out-Null
  Copy-Item -Recurse -Force AtomicBlast-Server\* (Join-Path $tempRoot "AtomicBlast-Server")
  Copy-Item -Force deploy\aws\buildspec.yml (Join-Path $tempRoot "buildspec.yml")
  Compress-Archive -Path (Join-Path $tempRoot "AtomicBlast-Server"), (Join-Path $tempRoot "buildspec.yml") -DestinationPath $sourceZip -Force
  aws s3 cp $sourceZip "s3://$sourceBucketName/atomic-blast/source.zip" | Out-Null
} finally {
  Remove-Item -Recurse -Force -LiteralPath $tempRoot -ErrorAction SilentlyContinue
}

$buildId = aws codebuild start-build `
  --project-name $projectName `
  --environment-variables-override "name=IMAGE_TAG,value=$ImageTag,type=PLAINTEXT" `
  --query "build.id" `
  --output text

Write-Host "Started CodeBuild build $buildId"
aws codebuild batch-get-builds --ids $buildId --query "builds[0].{status:buildStatus,phase:currentPhase,start:startTime}" --output table

while ($true) {
  Start-Sleep -Seconds 15
  $status = aws codebuild batch-get-builds --ids $buildId --query "builds[0].buildStatus" --output text
  Write-Host "CodeBuild status: $status"
  if ($status -in @("SUCCEEDED", "FAILED", "FAULT", "STOPPED", "TIMED_OUT")) { break }
}

aws codebuild batch-get-builds --ids $buildId --query "builds[0].{status:buildStatus,logs:logs.deepLink,phases:phases[].{phase:phaseType,status:phaseStatus,duration:durationInSeconds}}" --output json

if ($status -ne "SUCCEEDED") {
  throw "CodeBuild image build did not succeed: $status"
}
