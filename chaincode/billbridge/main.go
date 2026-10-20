package main

import (
	"log"
	"os"

	"github.com/hyperledger/fabric-chaincode-go/v2/shim"
	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

// main starts the chaincode either as a classic peer-launched process or, when
// CHAINCODE_SERVER_ADDRESS is set, as an external Chaincode-as-a-Service (CCaaS) server.
func main() {
	cc, err := contractapi.NewChaincode(&BillBridgeContract{})
	if err != nil {
		log.Panicf("error creating billbridge chaincode: %v", err)
	}
	cc.Info.Title = "BillBridge"
	cc.Info.Version = "1.0.0"

	if addr := os.Getenv("CHAINCODE_SERVER_ADDRESS"); addr != "" {
		server := &shim.ChaincodeServer{
			CCID:     os.Getenv("CORE_CHAINCODE_ID_NAME"),
			Address:  addr,
			CC:       cc,
			TLSProps: shim.TLSProperties{Disabled: true},
		}
		if err := server.Start(); err != nil {
			log.Panicf("error starting billbridge chaincode server: %v", err)
		}
		return
	}
	if err := cc.Start(); err != nil {
		log.Panicf("error starting billbridge chaincode: %v", err)
	}
}
