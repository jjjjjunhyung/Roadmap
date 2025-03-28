output "aws_subnet" {
  description = "Public Subnet Lists"
  value       = module.vpc.public_subnets
}

output "aws_default_security_group" {
  description = "Default Security Group"
  value       = module.vpc.default_security_group_id
}

output "latest_amazon_linux_ami_id" {
  value = data.aws_ami.amazon_linux.id
}

output "eip" {
  value = aws_eip.public_ec2_eip.public_ip
}

output "api_endpoint" {
  value = aws_apigatewayv2_api.ec2_api.api_endpoint
}

output "root_domain_api" {
  value = "https://${local.domain_name}"
  description = "Root domain pointing to API Gateway"
}

output "www_domain" {
  value = "https://www.${local.domain_name}"
  description = "WWW subdomain pointing to API Gateway"
}

output "route53_nameservers" {
  description = "The nameservers for the Route53 zone - update these at your domain registrar"
  value       = aws_route53_zone.junhyung_zone.name_servers
}

# ECR 저장소 URL 출력
output "ecr_repository_url" {
  description = "ECR Repository URL"
  value       = aws_ecr_repository.app_repository.repository_url
}
