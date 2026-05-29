$ErrorActionPreference = "Stop"

$hostedZoneId = aws ssm get-parameter --name /atomic-radius/prod/dns/hosted_zone_id --query "Parameter.Value" --output text
$loadBalancerDnsName = aws cloudformation describe-stacks --stack-name atomic-radius-edge-alb --query "Stacks[0].Outputs[?OutputKey=='LoadBalancerDnsName'].OutputValue | [0]" --output text
$loadBalancerHostedZoneId = aws cloudformation describe-stacks --stack-name atomic-radius-edge-alb --query "Stacks[0].Outputs[?OutputKey=='LoadBalancerHostedZoneId'].OutputValue | [0]" --output text

$change = @{
  Comment = "Cut blast.atomicradius.app over to AtomicBlast AWS ALB"
  Changes = @(@{
    Action = "UPSERT"
    ResourceRecordSet = @{
      Name = "blast.atomicradius.app."
      Type = "A"
      AliasTarget = @{
        HostedZoneId = $loadBalancerHostedZoneId
        DNSName = "dualstack.$loadBalancerDnsName"
        EvaluateTargetHealth = $false
      }
    }
  })
}

$tempFile = New-TemporaryFile
try {
  Set-Content -LiteralPath $tempFile -Value ($change | ConvertTo-Json -Depth 10) -Encoding UTF8
  $changeId = aws route53 change-resource-record-sets --hosted-zone-id $hostedZoneId --change-batch "file://$tempFile" --query "ChangeInfo.Id" --output text
  Write-Host "Route 53 change: $changeId"
  aws route53 wait resource-record-sets-changed --id $changeId
} finally {
  Remove-Item -LiteralPath $tempFile -Force -ErrorAction SilentlyContinue
}

aws route53 list-resource-record-sets --hosted-zone-id $hostedZoneId --query "ResourceRecordSets[?Name=='blast.atomicradius.app.']" --output table
