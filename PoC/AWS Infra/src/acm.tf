# SSL/TLS Certificate
resource "aws_acm_certificate" "domain_cert" {
  domain_name               = local.domain_name
  subject_alternative_names = ["*.${local.domain_name}"]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = local.tags
}

# Certificate validation using DNS
resource "aws_route53_record" "cert_validation" {
  # Use distinct_by to prevent duplicate records with the same name
  for_each = {
    for dvo in distinct(aws_acm_certificate.domain_cert.domain_validation_options) : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  zone_id = aws_route53_zone.junhyung_zone.zone_id
  name    = each.value.name
  type    = each.value.type
  ttl     = 300
  records = [each.value.record]

  # Add allow_overwrite to handle existing records
  allow_overwrite = true
}

# Certificate validation completion
resource "aws_acm_certificate_validation" "cert_validation" {
  certificate_arn         = aws_acm_certificate.domain_cert.arn
  validation_record_fqdns = [for record in aws_route53_record.cert_validation : record.fqdn]
} 
