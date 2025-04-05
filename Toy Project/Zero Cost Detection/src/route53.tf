resource "aws_route53_zone" "junhyung_zone" {
  name = local.domain_name
  tags = local.tags
}

# A 레코드 - ALB로 향하도록 변경
resource "aws_route53_record" "junhyung_record" {
  zone_id = aws_route53_zone.junhyung_zone.zone_id
  name    = local.domain_name
  type    = "A"

  alias {
    name                   = aws_lb.app_lb.dns_name
    zone_id                = aws_lb.app_lb.zone_id
    evaluate_target_health = true
  }
}

# WWW 서브도메인 - ALB로 향하도록 변경
resource "aws_route53_record" "www_record" {
  zone_id = aws_route53_zone.junhyung_zone.zone_id
  name    = "www.${local.domain_name}"
  type    = "A"

  alias {
    name                   = aws_lb.app_lb.dns_name
    zone_id                = aws_lb.app_lb.zone_id
    evaluate_target_health = true
  }
}
