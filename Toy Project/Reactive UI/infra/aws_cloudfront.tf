# A front door in Seoul. Cloudflare's free plan answers Korean home ISPs from US PoPs (LAX, SEA),
# so every request crossed the Pacific twice (~1 s). CloudFront serves Korea from Seoul and then
# reaches the existing Cloudflare Tunnel through Cloudflare's Seoul PoP (datacenter networks get
# ICN), so the origin stays hidden and no port opens on the VM:
#
#   viewer -> CloudFront (Seoul) -> origin.<domain> (Cloudflare, proxied) -> tunnel -> VM
#
# CloudFront adds a secret header; the app trusts CloudFront-Viewer-Address (the real client IP)
# only on requests that carry it. Always Free covers this: 1 TB out and 10 M requests a month.
# `front_door` switches the public hostnames between Cloudflare and CloudFront (and back).

locals {
  origin_hostname = "origin.${var.domain}"
}

# ---- cost alarm first: $1 a month, actual or forecast --------------------------------------
resource "aws_budgets_budget" "monthly" {
  name         = "${local.name_prefix}-monthly"
  budget_type  = "COST"
  limit_amount = "1"
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.budget_email]
  }
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.budget_email]
  }
}

# ---- certificate (CloudFront needs it in us-east-1), validated through Cloudflare DNS -------
resource "aws_acm_certificate" "web" {
  domain_name               = var.domain
  subject_alternative_names = ["www.${var.domain}"]
  validation_method         = "DNS"
  tags                      = local.common_tags

  lifecycle {
    create_before_destroy = true
  }
}

resource "cloudflare_dns_record" "acm_validation" {
  for_each = {
    for o in aws_acm_certificate.web.domain_validation_options : o.domain_name => o
  }

  zone_id = cloudflare_zone.main.id
  name    = trimsuffix(each.value.resource_record_name, ".")
  type    = each.value.resource_record_type
  content = trimsuffix(each.value.resource_record_value, ".")
  proxied = false
  ttl     = 300
  comment = "ACM validation for CloudFront"
}

resource "aws_acm_certificate_validation" "web" {
  certificate_arn         = aws_acm_certificate.web.arn
  validation_record_fqdns = [for r in cloudflare_dns_record.acm_validation : r.name]
}

# ---- the secret CloudFront shows the app ---------------------------------------------------
resource "random_password" "origin_secret" {
  length  = 48
  special = false
}

# ---- what reaches the app ------------------------------------------------------------------
data "aws_cloudfront_cache_policy" "disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
}

# Every cookie and query string, the headers the app reads, and the viewer's real address.
# Host is left out: Cloudflare must see origin.<domain> to find the tunnel.
resource "aws_cloudfront_origin_request_policy" "app" {
  name    = "${local.name_prefix}-app"
  comment = "Cookies, query strings, the app's headers and the viewer address"

  cookies_config {
    cookie_behavior = "all"
  }
  query_strings_config {
    query_string_behavior = "all"
  }
  headers_config {
    header_behavior = "whitelist"
    headers {
      items = [
        "Accept",
        "Accept-Language",
        "Content-Type",
        "User-Agent",
        "X-Planner-Key",
        "CloudFront-Viewer-Address",
      ]
    }
  }
}

resource "aws_cloudfront_distribution" "web" {
  enabled         = true
  comment         = "${local.name_prefix}: Seoul front door for the Cloudflare tunnel"
  aliases         = local.web_hostnames
  price_class     = "PriceClass_All"
  http_version    = "http2and3"
  is_ipv6_enabled = true
  tags            = local.common_tags

  origin {
    origin_id   = "tunnel"
    domain_name = local.origin_hostname

    custom_origin_config {
      http_port                = 80
      https_port               = 443
      origin_protocol_policy   = "https-only"
      origin_ssl_protocols     = ["TLSv1.2"]
      origin_read_timeout      = 60
      origin_keepalive_timeout = 60
    }

    custom_header {
      name  = "X-Origin-Verify"
      value = random_password.origin_secret.result
    }
  }

  # pages and the API: never cached here
  default_cache_behavior {
    target_origin_id         = "tunnel"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = data.aws_cloudfront_cache_policy.disabled.id
    origin_request_policy_id = aws_cloudfront_origin_request_policy.app.id
    compress                 = true
  }

  # hashed build files: cached in Seoul (the app marks them immutable)
  ordered_cache_behavior {
    path_pattern           = "/assets/*"
    target_origin_id       = "tunnel"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = data.aws_cloudfront_cache_policy.optimized.id
    compress               = true
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.web.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}
