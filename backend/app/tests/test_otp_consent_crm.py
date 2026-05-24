import secrets
from fastapi.testclient import TestClient
from app.tests.conftest import auth_headers
from app.tests.test_document_flow import create_uploaded_document, add_recipient, add_field, token_from_link


def test_otp_and_consent_signing_flow(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    document_id = create_uploaded_document(client, pdf_bytes, headers)
    
    # Create recipient with OTP enabled
    response = client.post(
        f"/api/documents/{document_id}/recipients",
        headers=headers,
        json={
            "name": "OTP Signer",
            "email": "otpsigner@example.com",
            "role_name": "Signer",
            "signing_order": 1,
            "otp_enabled": True,
            "phone_number": "+15550199"
        },
    )
    assert response.status_code == 201, response.text
    signer_id = response.json()["id"]
    
    field_id = add_field(client, document_id, headers, signer_id, "text", "Input field", 680)
    
    sent = client.post(f"/api/documents/{document_id}/send", headers=headers)
    assert sent.status_code == 200, sent.text
    
    signer_link = sent.json()["signing_links"][0]["signing_link"]
    token = token_from_link(signer_link)
    
    # 1. Fetching session should report that OTP is required and consent is required
    session = client.get(f"/api/sign/{token}")
    assert session.status_code == 200
    assert session.json()["otp_required"] is True
    assert session.json()["consent_required"] is True
    # Fields and PDF URL must be hidden/empty when unauthenticated
    assert session.json()["fields"] == []
    assert session.json()["pdf_url"] == ""
    
    # 2. Downloading PDF directly should be blocked by OTP
    pdf_response = client.get(f"/api/sign/{token}/pdf")
    assert pdf_response.status_code == 403
    assert "OTP verification required" in pdf_response.text
    
    # 3. Trying to save field values should be blocked
    save_blocked = client.post(f"/api/sign/{token}/fields/{field_id}/value", json={"value": "Hello"})
    assert save_blocked.status_code == 403
    
    # 4. Mock secrets.choice so we know the generated OTP code is '111111'
    original_choice = secrets.choice
    secrets.choice = lambda seq: '1'
    
    try:
        # Request / Send OTP code
        otp_send = client.post(f"/api/sign/{token}/otp/send")
        assert otp_send.status_code == 204
        
        # 5. Try verifying with wrong code
        otp_verify_fail = client.post(f"/api/sign/{token}/otp/verify", json={"code": "000000"})
        assert otp_verify_fail.status_code == 400
        
        # 6. Verify with the correct code ('111111')
        otp_verify_success = client.post(f"/api/sign/{token}/otp/verify", json={"code": "111111"})
        assert otp_verify_success.status_code == 200
        assert otp_verify_success.json()["otp_required"] is False
        assert otp_verify_success.json()["consent_required"] is True  # Still needs consent
        
    finally:
        # Restore mock
        secrets.choice = original_choice
    
    # 7. Try saving field value before consent - still blocked
    save_blocked_consent = client.post(f"/api/sign/{token}/fields/{field_id}/value", json={"value": "Hello"})
    assert save_blocked_consent.status_code == 403
    assert "Consent confirmation required" in save_blocked_consent.text
    
    # 8. Accept ESIGN electronic consent
    consent_response = client.post(f"/api/sign/{token}/consent")
    assert consent_response.status_code == 200
    assert consent_response.json()["otp_required"] is False
    assert consent_response.json()["consent_required"] is False
    # Now fields and PDF URL are loaded!
    assert len(consent_response.json()["fields"]) == 1
    assert consent_response.json()["pdf_url"] != ""
    
    # 9. Now saving field values succeeds
    save_success = client.post(f"/api/sign/{token}/fields/{field_id}/value", json={"value": "UETA Compliant Value"})
    assert save_success.status_code == 200
    
    # 10. Complete document
    complete_response = client.post(f"/api/sign/{token}/complete")
    assert complete_response.status_code == 200
    assert complete_response.json()["document_status"] == "completed"
    
    # 11. Verify that CRM audit logs were written
    audit = client.get(f"/api/documents/{document_id}/audit-logs", headers=headers)
    assert audit.status_code == 200
    event_types = [log["event_type"] for log in audit.json()]
    assert "signer_otp_sent" in event_types
    assert "signer_otp_verified" in event_types
    assert "consent_accepted" in event_types
    assert "crm_internal_task_triggered" in event_types
    assert "crm_document_attached" in event_types
    assert "crm_loan_milestone_updated" in event_types
    assert "crm_realtor_pipeline_updated" in event_types
