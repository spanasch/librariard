from flask import Flask, request, jsonify
from flask_cors import CORS
from get_checkouts import handle_checkout

app = Flask(__name__)
CORS(app)   # ← allow all origins by default

@app.route("/checkouts", methods=["GET"])
def checkouts():
    result = handle_checkout(request.args)
    return jsonify(result["body"]), result["statusCode"]
