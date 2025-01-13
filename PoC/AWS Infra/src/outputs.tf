output "aws_subnet" {
  description = "Public Subnet Lists"
  value       = module.vpc.public_subnets
}

output "aws_default_security_group" {
  description = "Default Security Group"
  value       = module.vpc.default_security_group_id
}
