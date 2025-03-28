resource "aws_route53_zone" "junhyung_zone" {
  name = local.domain_name
  tags = local.tags
}

resource "aws_route53_record" "junhyung_record" {
  zone_id = aws_route53_zone.junhyung_zone.zone_id
  name    = local.domain_name
  type    = "A"

  alias {
    name                   = aws_apigatewayv2_domain_name.root_domain.domain_name_configuration[0].target_domain_name
    zone_id                = aws_apigatewayv2_domain_name.root_domain.domain_name_configuration[0].hosted_zone_id
    evaluate_target_health = false
  }
}

# WWW subdomain record
resource "aws_route53_record" "www_record" {
  zone_id = aws_route53_zone.junhyung_zone.zone_id
  name    = "www.${local.domain_name}"
  type    = "A"

  alias {
    name                   = aws_apigatewayv2_domain_name.www_domain.domain_name_configuration[0].target_domain_name
    zone_id                = aws_apigatewayv2_domain_name.www_domain.domain_name_configuration[0].hosted_zone_id
    evaluate_target_health = false
  }
}
