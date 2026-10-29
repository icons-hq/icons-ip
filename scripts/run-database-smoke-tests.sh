#!/usr/bin/env bash
set -euo pipefail
# This is the original regression sequence, executed only inside the explicit
# isolated legacy-fixture wrapper. Capability tests run outside this interval.
: "${OPERATOR_LEGACY_FIXTURE_TEST_SCOPE:?run through with-legacy-operator-fixtures.mjs}"
db_container="${SUPABASE_DB_CONTAINER:?explicit isolated container required}"
db_port="${PGPORT:-54322}"
export SUPABASE_DB_CONTAINER="$db_container"
export SUPABASE_DB_DATABASE="${SUPABASE_DB_DATABASE:-postgres}"
run_sql_test() {
  cat supabase/tests/helpers/goods_kc_fixture.sql "$1" | docker exec -i "$db_container" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1
}
run_sql_test supabase/tests/catalog_baseline.sql
run_sql_test supabase/tests/profile_editing.sql
run_sql_test supabase/tests/minimum_age_gate.sql
run_sql_test supabase/tests/adult_verification.sql
run_sql_test supabase/tests/account_deletion_phase_one.sql
bash supabase/tests/account_deletion_phase_one_concurrency.sh
run_sql_test supabase/tests/email_dispatcher_dark.sql
run_sql_test supabase/tests/email_dispatch_acceptance_recovery.sql
bash supabase/tests/email_dispatcher_concurrency.sh
run_sql_test supabase/tests/in_app_notifications.sql
run_sql_test supabase/tests/admin_notification_console.sql
run_sql_test supabase/tests/admin_role_management.sql
run_sql_test supabase/tests/admin_member_suspension.sql
run_sql_test supabase/tests/admin_artwork_upload_storage.sql
run_sql_test supabase/tests/goods_gallery_nine_images.sql
run_sql_test supabase/tests/home_curations.sql
bash supabase/tests/home_curations_concurrency.sh
run_sql_test supabase/tests/cart_items.sql
run_sql_test supabase/tests/checkout_order.sql
run_sql_test supabase/tests/order_history.sql
run_sql_test supabase/tests/payment_provider_foundation.sql
bash scripts/test-payment-provider-production-readback.sh
run_sql_test supabase/tests/goods_payment_provider_seam.sql
bash supabase/tests/goods_payment_provider_seam_concurrency.sh
run_sql_test supabase/tests/goods_payment_cancellation_guard.sql
bash supabase/tests/goods_payment_cancellation_guard_concurrency.sh
bash supabase/tests/goods_payment_expiry_claim_concurrency.sh
run_sql_test supabase/tests/goods_payment_manual_recovery.sql
bash supabase/tests/goods_payment_manual_recovery_concurrency.sh
bash supabase/tests/goods_payment_cancellation_refund_race_concurrency.sh
bash supabase/tests/goods_payment_expired_prepared_cancel_concurrency.sh
run_sql_test supabase/tests/ticket_payment_provider_seam.sql
bash supabase/tests/ticket_payment_provider_seam_concurrency.sh
run_sql_test supabase/tests/order_cancellation.sql
run_sql_test supabase/tests/order_cancellation_system_reconcile.sql
run_sql_test supabase/tests/staff_order_cancellation.sql
run_sql_test supabase/tests/order_claim_expired_prepared_cancellation.sql
run_sql_test supabase/tests/order_withdrawal_deadline.sql
run_sql_test supabase/tests/order_status_ladder.sql
run_sql_test supabase/tests/admin_order_console.sql
run_sql_test supabase/tests/admin_order_search.sql
run_sql_test supabase/tests/admin_coupon_search.sql
run_sql_test supabase/tests/shipping_carrier_registry.sql
run_sql_test supabase/tests/order_dispatch_delay_notes.sql
run_sql_test supabase/tests/order_delay_notices.sql
run_sql_test supabase/tests/order_delay_notice_recovery.sql
ORDER_DELAY_TEST_SCOPE=1 SUPABASE_DB_CONTAINER="$db_container" SUPABASE_DB_DATABASE=postgres bash supabase/tests/order_delay_notices_concurrency.sh
run_sql_test supabase/tests/admin_stock_adjustment.sql
run_sql_test supabase/tests/admin_ticket_type_console.sql
run_sql_test supabase/tests/admin_card_pool_console.sql
run_sql_test supabase/tests/admin_reward_policy_console.sql
run_sql_test supabase/tests/admin_game_console.sql
run_sql_test supabase/tests/card_reward_global_gate.sql
bash supabase/tests/card_reward_global_gate_concurrency.sh
run_sql_test supabase/tests/ticket_booking_flow.sql
run_sql_test supabase/tests/ticket_cancellation_flow.sql
run_sql_test supabase/tests/ticket_check_in_flow.sql
run_sql_test supabase/tests/community_comment_like_actions.sql
run_sql_test supabase/tests/community_moderation_actions.sql
run_sql_test supabase/tests/community_trending_tags.sql
run_sql_test supabase/tests/community_feed_personalization.sql
run_sql_test supabase/tests/community_post_editing.sql
run_sql_test supabase/tests/community_comment_moderation.sql
run_sql_test supabase/tests/community_write_gate.sql
run_sql_test supabase/tests/search_public_content.sql
run_sql_test supabase/tests/catalog_archiving.sql
run_sql_test supabase/tests/ip_publish_state.sql
run_sql_test supabase/tests/ip_purchase_publish_guard.sql
run_sql_test supabase/tests/search_catalog_visibility.sql
bash supabase/tests/ip_purchase_publish_concurrency.sh
run_sql_test supabase/tests/inquiry_threads.sql
run_sql_test supabase/tests/inquiry_assignment_and_private_notes.sql
run_sql_test supabase/tests/faq_entries.sql
run_sql_test supabase/tests/goods_notice_presets.sql
run_sql_test supabase/tests/goods_notice_kc_templates.sql
run_sql_test supabase/tests/admin_order_detail.sql
run_sql_test supabase/tests/goods_variants_expand.sql
run_sql_test supabase/tests/shipping_policy_lookup.sql
run_sql_test supabase/tests/admin_customer_detail.sql
run_sql_test supabase/tests/ip_directory_workspace.sql
run_sql_test supabase/tests/goods_identifiers.sql
run_sql_test supabase/tests/store_settings.sql
run_sql_test supabase/tests/inquiry_auto_reply_settings.sql
run_sql_test supabase/tests/inquiry_system_messages.sql
run_sql_test supabase/tests/admin_operations_contacts.sql
run_sql_test supabase/tests/admin_goods_directory.sql
run_sql_test supabase/tests/admin_goods_readiness_workspace.sql
run_sql_test supabase/tests/admin_work_queue.sql
run_sql_test supabase/tests/goods_inactive_shipping_fee.sql
run_sql_test supabase/tests/goods_publish_state.sql
run_sql_test supabase/tests/fulfillment_origins_policy.sql
run_sql_test supabase/tests/fulfillment_zero_price_policy.sql
run_sql_test supabase/tests/inquiry_realtime_delivery.sql
run_sql_test supabase/tests/cart_order_variants.sql
run_sql_test supabase/tests/option_stock_recovery_reshipment.sql
run_sql_test supabase/tests/goods_option_editor.sql
run_sql_test supabase/tests/goods_variant_operations.sql
run_sql_test supabase/tests/goods_option_reference_lifecycle.sql
run_sql_test supabase/tests/goods_english_name.sql
run_sql_test supabase/tests/goods_discovery_metadata.sql
run_sql_test supabase/tests/ip_public_slug_identity.sql
run_sql_test supabase/tests/goods_variant_external_identity.sql
run_sql_test supabase/tests/goods_purchase_policies.sql
run_sql_test supabase/tests/goods_sales_publication.sql
run_sql_test supabase/tests/sales_review_cleanup.sql
run_sql_test supabase/tests/goods_discount_display.sql
run_sql_test supabase/tests/goods_additional_categories.sql
run_sql_test supabase/tests/sales_category_hierarchy.sql
run_sql_test supabase/tests/erp_item_master.sql
run_sql_test supabase/tests/shipping_notice_templates.sql
run_sql_test supabase/tests/goods_variant_purchase_cost.sql
run_sql_test supabase/tests/sales_claim_policy_costs.sql
run_sql_test supabase/tests/store_credit_ledger.sql
run_sql_test supabase/tests/store_credit_checkout.sql
run_sql_test supabase/tests/store_credit_earned_refund.sql
run_sql_test supabase/tests/goods_clone.sql
run_sql_test supabase/tests/goods_detail_html.sql
bash supabase/tests/goods_detail_html_concurrency.sh "$db_container" postgres
run_sql_test supabase/tests/goods_additional.sql
run_sql_test supabase/tests/goods_kc_compliance.sql
run_sql_test supabase/tests/goods_kc_not_applicable_quick_review.sql
run_sql_test supabase/tests/goods_kc_publish_draft_fallback.sql
run_sql_test supabase/tests/goods_preorders.sql
run_sql_test supabase/tests/goods_workspace_atomic_save.sql
run_sql_test supabase/tests/coupon_targeting.sql
run_sql_test supabase/tests/coupon_targeting_restore.sql
run_sql_test supabase/tests/checkout_coupon_expectation.sql
run_sql_test supabase/tests/settled_export.sql
run_sql_test supabase/tests/admin_list_export_audit.sql
run_sql_test supabase/tests/shipping_regions.sql
run_sql_test supabase/tests/shipping_region_expiry.sql
run_sql_test supabase/tests/shipment_delivery_methods.sql
bash supabase/tests/goods_purchase_policies_concurrency.sh "$db_container" postgres
bash supabase/tests/sales_category_hierarchy_concurrency.sh "$db_container" postgres
SUPABASE_DB_CONTAINER="$db_container" bash supabase/tests/store_credit_concurrency.sh
SUPABASE_DB_CONTAINER="$db_container" SUPABASE_DB_DATABASE=postgres bash supabase/tests/coupon_targeting_concurrency.sh
bash supabase/tests/goods_preorders_concurrency.sh "$db_container" postgres
bash supabase/tests/goods_clone_concurrency.sh "$db_container" postgres
run_sql_test supabase/tests/goods_option_contract.sql
run_sql_test supabase/tests/order_shipments_expand.sql
run_sql_test supabase/tests/order_shipments_transitions.sql
run_sql_test supabase/tests/order_shipments_contract.sql
run_sql_test supabase/tests/shipment_dispatch_workspace.sql
run_sql_test supabase/tests/shipment_export.sql
run_sql_test supabase/tests/shipment_export_variant_code.sql
run_sql_test supabase/tests/shipment_export_external_identity.sql
run_sql_test supabase/tests/warehouse_native_tracking.sql
run_sql_test supabase/tests/warehouse_reply_exchange.sql
run_sql_test supabase/tests/goods_excel_imports.sql
run_sql_test supabase/tests/order_shipment_email_jobs.sql
PSQL_BIN=psql PGHOST=127.0.0.1 PGPORT="$db_port" PGUSER=postgres PGPASSWORD=postgres PGDATABASE=postgres bash supabase/tests/option_stock_recovery_concurrency.sh
bash supabase/tests/order_shipments_concurrency.sh
PSQL_BIN=psql PGHOST=127.0.0.1 PGPORT="$db_port" PGUSER=postgres PGPASSWORD=postgres PGDATABASE=postgres bash supabase/tests/order_claim_origin_concurrency.sh
bash supabase/tests/order_shipment_email_jobs_concurrency.sh
bash supabase/tests/goods_publish_concurrency.sh
bash supabase/tests/cart_order_variants_concurrency.sh
PSQL_BIN=psql PGHOST=127.0.0.1 PGPORT="$db_port" PGUSER=postgres PGPASSWORD=postgres PGDATABASE=postgres bash supabase/tests/fulfillment_origins_concurrency.sh
bash supabase/tests/goods_identifiers_concurrency.sh
bash supabase/tests/ip_directory_workspace_concurrency.sh
bash supabase/tests/goods_variants_expand_concurrency.sh
docker cp supabase "$db_container":/tmp/admin-ops-sql
docker exec -i "$db_container" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/admin-ops-sql/tests/helpers/goods_kc_fixture.sql -f /tmp/admin-ops-sql/tests/admin_ops_staging_seed.sql
PSQL_BIN=psql PGHOST=127.0.0.1 PGPORT="$db_port" PGUSER=postgres PGPASSWORD=postgres PGDATABASE=postgres node supabase/tests/admin_ops_rehearsal.mjs
docker exec -i "$db_container" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/admin-ops-sql/tests/helpers/goods_kc_fixture.sql -f /tmp/admin-ops-sql/tests/goods_variants_seed.sql
docker exec -i "$db_container" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/admin-ops-sql/tests/helpers/goods_kc_fixture.sql -f /tmp/admin-ops-sql/tests/ip_directory_seed.sql
run_sql_test supabase/tests/order_claims.sql
run_sql_test supabase/tests/order_claim_origin_policy.sql
run_sql_test supabase/tests/order_claim_reshipment_delivery.sql
run_sql_test supabase/tests/goods_reviews.sql
run_sql_test supabase/tests/bank_transfer_payments.sql
run_sql_test supabase/tests/goods_sale_restriction.sql
run_sql_test supabase/tests/bank_deposit_feed.sql
run_sql_test supabase/tests/admin_stats_reports.sql
run_sql_test supabase/tests/commerce_wishlist_restock.sql
run_sql_test supabase/tests/goods_variant_purchase_limits.sql
run_sql_test supabase/tests/random_option_allocation.sql
run_sql_test supabase/tests/random_option_customer_masking.sql
run_sql_test supabase/tests/restock_alerts_variants.sql
run_sql_test supabase/tests/coupon_redemption.sql
bash supabase/tests/coupon_issue_concurrency.sh
run_sql_test supabase/tests/loyalty_grades.sql
run_sql_test supabase/tests/campaigns.sql
run_sql_test supabase/tests/coin_participation.sql
run_sql_test supabase/tests/product_questions.sql
run_sql_test supabase/tests/s8_review_hardening.sql
bash supabase/tests/coin_exchange_concurrency.sh

# Current admin-console features also exercise the same real guarded RPCs.
run_sql_test supabase/tests/admin_sales_console_search.sql
run_sql_test supabase/tests/admin_goods_console_filters.sql
run_sql_test supabase/tests/goods_purchase_restrictions.sql
run_sql_test supabase/tests/admin_goods_announcements.sql
run_sql_test supabase/tests/admin_coupon_console.sql
run_sql_test supabase/tests/home_curation_latest_goods.sql
run_sql_test supabase/tests/admin_store_credit_batches.sql
run_sql_test supabase/tests/home_layout_order.sql
run_sql_test supabase/tests/goods_custom_inputs.sql
run_sql_test supabase/tests/admin_benefit_report.sql
run_sql_test supabase/tests/home_sales_and_review_curations.sql
run_sql_test supabase/tests/goods_review_summaries.sql
run_sql_test supabase/tests/admin_operations_dock.sql
run_sql_test supabase/tests/admin_shipping_settings_templates.sql
run_sql_test supabase/tests/admin_cs_reply_tools.sql
run_sql_test supabase/tests/checkout_cart_snapshot.sql
run_sql_test supabase/tests/purchase_restriction_batches.sql
run_sql_test supabase/tests/coupon_issue_schedule.sql
run_sql_test supabase/tests/store_branding_settings.sql
run_sql_test supabase/tests/admin_goods_photo_library.sql
run_sql_test supabase/tests/admin_seller_claim_intake.sql
run_sql_test supabase/tests/admin_optimistic_conflicts_http409.sql
run_sql_test supabase/tests/admin_review_insights.sql
run_sql_test supabase/tests/store_navigation_settings.sql
run_sql_test supabase/tests/goods_relations.sql
run_sql_test supabase/tests/admin_goods_server_drafts.sql
run_sql_test supabase/tests/admin_inquiry_reply_template_management.sql
run_sql_test supabase/tests/home_product_mosaic.sql
run_sql_test supabase/tests/admin_loyalty_policy.sql
run_sql_test supabase/tests/loyalty_grade_benefits.sql
run_sql_test supabase/tests/address_book.sql
ADDRESS_BOOK_TEST_SCOPE=ci SUPABASE_DB_CONTAINER="$db_container" bash supabase/tests/address_book_concurrency.sh
run_sql_test supabase/tests/goods_dynamic_attributes.sql
run_sql_test supabase/tests/goods_three_axis_options.sql
bash supabase/tests/goods_photo_library_concurrency.sh "$db_container" postgres
bash supabase/tests/goods_draft_completion_concurrency.sh "$db_container" postgres
bash supabase/tests/home_product_mosaic_concurrency.sh "$db_container" postgres
