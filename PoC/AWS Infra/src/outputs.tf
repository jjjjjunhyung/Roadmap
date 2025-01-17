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
