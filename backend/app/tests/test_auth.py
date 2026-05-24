from fastapi.testclient import TestClient


def test_register_and_login(client: TestClient) -> None:
    response = client.post(
        "/api/auth/register",
        json={
            "organization_name": "North Star Mortgage",
            "name": "Morgan Sender",
            "email": "morgan@example.com",
            "password": "strong-password",
        },
    )
    assert response.status_code == 201, response.text
    assert response.json()["user"]["role"] == "admin"

    login = client.post(
        "/api/auth/login",
        json={"email": "morgan@example.com", "password": "strong-password"},
    )
    assert login.status_code == 200, login.text
    assert login.json()["access_token"]

