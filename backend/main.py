from flask import Flask, request, jsonify
from get_checkouts import handle_checkout

app = Flask(__name__)

@app.route("/checkouts", methods=["GET"])
def checkouts():
    result = handle_checkout(request.args)
    return jsonify(result["body"]), result["statusCode"]
