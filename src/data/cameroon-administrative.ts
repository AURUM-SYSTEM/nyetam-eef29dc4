// Référentiel administratif du Cameroun — 10 régions, 58 départements, 360 arrondissements.
// Source: Open Admin Data / OCHA COD-AB Cameroon, CC BY-4.0.
// Ce fichier est embarqué localement pour rester disponible hors-ligne.
export type CameroonDepartment = { id: string; name: string; arrondissements: Array<{ id: string; name: string }> };
export type CameroonRegion = { id: string; name: string; departments: CameroonDepartment[] };

export const CAMEROON_ADMINISTRATIVE_HIERARCHY: CameroonRegion[] = [
  {
    "id": "CM001",
    "name": "Adamaoua",
    "departments": [
      {
        "id": "CM001001",
        "name": "Djérem",
        "arrondissements": [
          {
            "id": "CM001001001",
            "name": "Ngaoundal"
          },
          {
            "id": "CM001001002",
            "name": "Tibati"
          }
        ]
      },
      {
        "id": "CM001002",
        "name": "Faro-et-Déo",
        "arrondissements": [
          {
            "id": "CM001002001",
            "name": "Galim-Tignere"
          },
          {
            "id": "CM001002002",
            "name": "Kontcha"
          },
          {
            "id": "CM001002003",
            "name": "Mayo-Baleo"
          },
          {
            "id": "CM001002004",
            "name": "Tignere"
          }
        ]
      },
      {
        "id": "CM001003",
        "name": "Mayo-Banyo",
        "arrondissements": [
          {
            "id": "CM001003001",
            "name": "Bankim"
          },
          {
            "id": "CM001003002",
            "name": "Banyo"
          },
          {
            "id": "CM001003003",
            "name": "Mayo-Darle"
          }
        ]
      },
      {
        "id": "CM001004",
        "name": "Mbéré",
        "arrondissements": [
          {
            "id": "CM001004001",
            "name": "Dir"
          },
          {
            "id": "CM001004002",
            "name": "Djohong"
          },
          {
            "id": "CM001004003",
            "name": "Meiganga"
          },
          {
            "id": "CM001004004",
            "name": "Ngaoui"
          }
        ]
      },
      {
        "id": "CM001005",
        "name": "Vina",
        "arrondissements": [
          {
            "id": "CM001005001",
            "name": "Belel"
          },
          {
            "id": "CM001005002",
            "name": "Martap"
          },
          {
            "id": "CM001005003",
            "name": "Mbe"
          },
          {
            "id": "CM001005004",
            "name": "Nganha"
          },
          {
            "id": "CM001005005",
            "name": "Ngaoundere 1er"
          },
          {
            "id": "CM001005006",
            "name": "Ngaoundere 2e"
          },
          {
            "id": "CM001005007",
            "name": "Ngaoundere 3e"
          },
          {
            "id": "CM001005008",
            "name": "Nyambaka"
          }
        ]
      }
    ]
  },
  {
    "id": "CM002",
    "name": "Centre",
    "departments": [
      {
        "id": "CM002001",
        "name": "Haute-Sanaga",
        "arrondissements": [
          {
            "id": "CM002001001",
            "name": "Bibey"
          },
          {
            "id": "CM002001002",
            "name": "Lembe Yezoum"
          },
          {
            "id": "CM002001003",
            "name": "Mbandjock"
          },
          {
            "id": "CM002001004",
            "name": "Minta"
          },
          {
            "id": "CM002001005",
            "name": "Nanga-Eboko"
          },
          {
            "id": "CM002001006",
            "name": "Nkoteng"
          },
          {
            "id": "CM002001007",
            "name": "Nsem"
          }
        ]
      },
      {
        "id": "CM002002",
        "name": "Lekié",
        "arrondissements": [
          {
            "id": "CM002002001",
            "name": "Batchenga"
          },
          {
            "id": "CM002002002",
            "name": "Ebebda"
          },
          {
            "id": "CM002002003",
            "name": "Elig-Mfomo"
          },
          {
            "id": "CM002002004",
            "name": "Evodoula"
          },
          {
            "id": "CM002002005",
            "name": "Lobo"
          },
          {
            "id": "CM002002006",
            "name": "Monatele"
          },
          {
            "id": "CM002002007",
            "name": "Obala"
          },
          {
            "id": "CM002002008",
            "name": "Okola"
          },
          {
            "id": "CM002002009",
            "name": "Saa"
          }
        ]
      },
      {
        "id": "CM002003",
        "name": "Mbam-et-Inoubou",
        "arrondissements": [
          {
            "id": "CM002003001",
            "name": "Bafia"
          },
          {
            "id": "CM002003002",
            "name": "Bokito"
          },
          {
            "id": "CM002003003",
            "name": "Deuk"
          },
          {
            "id": "CM002003004",
            "name": "Kiiki"
          },
          {
            "id": "CM002003005",
            "name": "Kon Yambetta"
          },
          {
            "id": "CM002003006",
            "name": "Makenene"
          },
          {
            "id": "CM002003007",
            "name": "Ndikinimeki"
          },
          {
            "id": "CM002003008",
            "name": "Nitoukou"
          },
          {
            "id": "CM002003009",
            "name": "Ombessa"
          }
        ]
      },
      {
        "id": "CM002004",
        "name": "Mbam-et-Kim",
        "arrondissements": [
          {
            "id": "CM002004001",
            "name": "Mbangassina"
          },
          {
            "id": "CM002004002",
            "name": "Ngambe-Tikar"
          },
          {
            "id": "CM002004003",
            "name": "Ngoro"
          },
          {
            "id": "CM002004004",
            "name": "Ntui"
          },
          {
            "id": "CM002004005",
            "name": "Yoko"
          }
        ]
      },
      {
        "id": "CM002005",
        "name": "Mefou-et-Afamba",
        "arrondissements": [
          {
            "id": "CM002005001",
            "name": "Afanloum"
          },
          {
            "id": "CM002005002",
            "name": "Assamba"
          },
          {
            "id": "CM002005003",
            "name": "Awae"
          },
          {
            "id": "CM002005004",
            "name": "Edzendouan"
          },
          {
            "id": "CM002005005",
            "name": "Esse"
          },
          {
            "id": "CM002005006",
            "name": "Mfou"
          },
          {
            "id": "CM002005007",
            "name": "Nkolafamba"
          },
          {
            "id": "CM002005008",
            "name": "Soa"
          }
        ]
      },
      {
        "id": "CM002006",
        "name": "Mefou-et-Akono",
        "arrondissements": [
          {
            "id": "CM002006001",
            "name": "Akono"
          },
          {
            "id": "CM002006002",
            "name": "Bikok"
          },
          {
            "id": "CM002006003",
            "name": "Mbankomo"
          },
          {
            "id": "CM002006004",
            "name": "Ngoumou"
          }
        ]
      },
      {
        "id": "CM002007",
        "name": "Mfoundi",
        "arrondissements": [
          {
            "id": "CM002007001",
            "name": "Yaounde 1er"
          },
          {
            "id": "CM002007002",
            "name": "Yaounde 2e"
          },
          {
            "id": "CM002007003",
            "name": "Yaounde 3e"
          },
          {
            "id": "CM002007004",
            "name": "Yaounde 4e"
          },
          {
            "id": "CM002007005",
            "name": "Yaounde 5e"
          },
          {
            "id": "CM002007006",
            "name": "Yaounde 6e"
          },
          {
            "id": "CM002007007",
            "name": "Yaounde 7e"
          }
        ]
      },
      {
        "id": "CM002008",
        "name": "Nyong-et-Kellé",
        "arrondissements": [
          {
            "id": "CM002008001",
            "name": "Biyouha"
          },
          {
            "id": "CM002008002",
            "name": "Bondjock"
          },
          {
            "id": "CM002008003",
            "name": "Bot-Makak"
          },
          {
            "id": "CM002008004",
            "name": "Dibang"
          },
          {
            "id": "CM002008005",
            "name": "Eseka"
          },
          {
            "id": "CM002008006",
            "name": "Makak"
          },
          {
            "id": "CM002008007",
            "name": "Matomb"
          },
          {
            "id": "CM002008008",
            "name": "Messondo"
          },
          {
            "id": "CM002008009",
            "name": "Ngog-Mapubi"
          },
          {
            "id": "CM002008010",
            "name": "Nguibassal"
          }
        ]
      },
      {
        "id": "CM002009",
        "name": "Nyong-et-Mfoumou",
        "arrondissements": [
          {
            "id": "CM002009001",
            "name": "Akonolinga"
          },
          {
            "id": "CM002009002",
            "name": "Ayos"
          },
          {
            "id": "CM002009003",
            "name": "Endom"
          },
          {
            "id": "CM002009004",
            "name": "Mengang"
          },
          {
            "id": "CM002009005",
            "name": "Nyakokombo"
          }
        ]
      },
      {
        "id": "CM002010",
        "name": "Nyong-et-So'o",
        "arrondissements": [
          {
            "id": "CM002010001",
            "name": "Akoeman"
          },
          {
            "id": "CM002010002",
            "name": "Dzeng"
          },
          {
            "id": "CM002010003",
            "name": "Mbalmayo"
          },
          {
            "id": "CM002010004",
            "name": "Mengueme"
          },
          {
            "id": "CM002010005",
            "name": "Ngomedzap"
          },
          {
            "id": "CM002010006",
            "name": "Nkolmetet"
          }
        ]
      }
    ]
  },
  {
    "id": "CM003",
    "name": "Est",
    "departments": [
      {
        "id": "CM003001",
        "name": "Boumba-et-Ngoko",
        "arrondissements": [
          {
            "id": "CM003001001",
            "name": "Gari Gombo"
          },
          {
            "id": "CM003001002",
            "name": "Moloundou"
          },
          {
            "id": "CM003001003",
            "name": "Salapoumbe"
          },
          {
            "id": "CM003001004",
            "name": "Yokadouma"
          }
        ]
      },
      {
        "id": "CM003002",
        "name": "Haut-Nyong",
        "arrondissements": [
          {
            "id": "CM003002001",
            "name": "Abong-Mbang"
          },
          {
            "id": "CM003002002",
            "name": "Bebend"
          },
          {
            "id": "CM003002003",
            "name": "Dimako"
          },
          {
            "id": "CM003002004",
            "name": "Dja"
          },
          {
            "id": "CM003002005",
            "name": "Doumaintang"
          },
          {
            "id": "CM003002006",
            "name": "Doume"
          },
          {
            "id": "CM003002007",
            "name": "Lomie"
          },
          {
            "id": "CM003002008",
            "name": "Mboanz"
          },
          {
            "id": "CM003002009",
            "name": "Mboma"
          },
          {
            "id": "CM003002010",
            "name": "Messamena"
          },
          {
            "id": "CM003002011",
            "name": "Messok"
          },
          {
            "id": "CM003002012",
            "name": "Ngoyla"
          },
          {
            "id": "CM003002013",
            "name": "Nguelemendouka"
          },
          {
            "id": "CM003002014",
            "name": "Somalomo"
          }
        ]
      },
      {
        "id": "CM003003",
        "name": "Kadey",
        "arrondissements": [
          {
            "id": "CM003003001",
            "name": "Batouri"
          },
          {
            "id": "CM003003002",
            "name": "Bombe"
          },
          {
            "id": "CM003003003",
            "name": "Kette"
          },
          {
            "id": "CM003003004",
            "name": "Mbang"
          },
          {
            "id": "CM003003005",
            "name": "Mbotoro"
          },
          {
            "id": "CM003003006",
            "name": "Ndelele"
          },
          {
            "id": "CM003003007",
            "name": "Ndem Nam"
          }
        ]
      },
      {
        "id": "CM003004",
        "name": "Lom-et-Djérem",
        "arrondissements": [
          {
            "id": "CM003004001",
            "name": "Belabo"
          },
          {
            "id": "CM003004002",
            "name": "Bertoua 1er"
          },
          {
            "id": "CM003004003",
            "name": "Bertoua 2e"
          },
          {
            "id": "CM003004004",
            "name": "Betare-Oya"
          },
          {
            "id": "CM003004005",
            "name": "Diang"
          },
          {
            "id": "CM003004006",
            "name": "Garoua-Boulai"
          },
          {
            "id": "CM003004007",
            "name": "Mandjou"
          },
          {
            "id": "CM003004008",
            "name": "Ngoura"
          }
        ]
      }
    ]
  },
  {
    "id": "CM004",
    "name": "Extrême-Nord",
    "departments": [
      {
        "id": "CM004001",
        "name": "Diamaré",
        "arrondissements": [
          {
            "id": "CM004001001",
            "name": "Bogo"
          },
          {
            "id": "CM004001002",
            "name": "Dargala"
          },
          {
            "id": "CM004001003",
            "name": "Gazawa"
          },
          {
            "id": "CM004001004",
            "name": "Maroua 1er"
          },
          {
            "id": "CM004001005",
            "name": "Maroua 2e"
          },
          {
            "id": "CM004001006",
            "name": "Maroua 3e"
          },
          {
            "id": "CM004001007",
            "name": "Meri"
          },
          {
            "id": "CM004001008",
            "name": "Ndoukoula"
          },
          {
            "id": "CM004001009",
            "name": "Pette"
          }
        ]
      },
      {
        "id": "CM004002",
        "name": "Logone-et-Chari",
        "arrondissements": [
          {
            "id": "CM004002001",
            "name": "Blangoua"
          },
          {
            "id": "CM004002002",
            "name": "Darak"
          },
          {
            "id": "CM004002003",
            "name": "Fotokol"
          },
          {
            "id": "CM004002004",
            "name": "Goulfey"
          },
          {
            "id": "CM004002005",
            "name": "Hile-Alifa"
          },
          {
            "id": "CM004002006",
            "name": "Kousseri"
          },
          {
            "id": "CM004002007",
            "name": "Logone-Birni"
          },
          {
            "id": "CM004002008",
            "name": "Makary"
          },
          {
            "id": "CM004002009",
            "name": "Waza"
          },
          {
            "id": "CM004002010",
            "name": "Zina"
          }
        ]
      },
      {
        "id": "CM004003",
        "name": "Mayo-Danay",
        "arrondissements": [
          {
            "id": "CM004003001",
            "name": "Datcheka"
          },
          {
            "id": "CM004003002",
            "name": "Gobo"
          },
          {
            "id": "CM004003003",
            "name": "Guere"
          },
          {
            "id": "CM004003004",
            "name": "Kai-Kai"
          },
          {
            "id": "CM004003005",
            "name": "Kalfou"
          },
          {
            "id": "CM004003006",
            "name": "Kar-Hay"
          },
          {
            "id": "CM004003007",
            "name": "Maga"
          },
          {
            "id": "CM004003008",
            "name": "Tchatibali"
          },
          {
            "id": "CM004003009",
            "name": "Vele"
          },
          {
            "id": "CM004003010",
            "name": "Wina"
          },
          {
            "id": "CM004003011",
            "name": "Yagoua"
          }
        ]
      },
      {
        "id": "CM004004",
        "name": "Mayo-Kani",
        "arrondissements": [
          {
            "id": "CM004004001",
            "name": "Guidiguis"
          },
          {
            "id": "CM004004002",
            "name": "Kaele"
          },
          {
            "id": "CM004004003",
            "name": "Mindif"
          },
          {
            "id": "CM004004004",
            "name": "Moulvoudaye"
          },
          {
            "id": "CM004004005",
            "name": "Moutourwa"
          },
          {
            "id": "CM004004006",
            "name": "Porhi"
          },
          {
            "id": "CM004004007",
            "name": "Taibong"
          }
        ]
      },
      {
        "id": "CM004005",
        "name": "Mayo-Sava",
        "arrondissements": [
          {
            "id": "CM004005001",
            "name": "Kolofata"
          },
          {
            "id": "CM004005002",
            "name": "Mora"
          },
          {
            "id": "CM004005003",
            "name": "Tokombere"
          }
        ]
      },
      {
        "id": "CM004006",
        "name": "Mayo-Tsanaga",
        "arrondissements": [
          {
            "id": "CM004006001",
            "name": "Bourrha"
          },
          {
            "id": "CM004006002",
            "name": "Hina"
          },
          {
            "id": "CM004006003",
            "name": "Koza"
          },
          {
            "id": "CM004006004",
            "name": "Mayo-Moskota"
          },
          {
            "id": "CM004006005",
            "name": "Mogode"
          },
          {
            "id": "CM004006006",
            "name": "Mokolo"
          },
          {
            "id": "CM004006007",
            "name": "Soulede-Roua"
          }
        ]
      }
    ]
  },
  {
    "id": "CM005",
    "name": "Littoral",
    "departments": [
      {
        "id": "CM005001",
        "name": "Moungo",
        "arrondissements": [
          {
            "id": "CM005001001",
            "name": "Bare-Bakem"
          },
          {
            "id": "CM005001002",
            "name": "Dibombari"
          },
          {
            "id": "CM005001003",
            "name": "Fiko"
          },
          {
            "id": "CM005001004",
            "name": "Loum"
          },
          {
            "id": "CM005001005",
            "name": "Manjo"
          },
          {
            "id": "CM005001006",
            "name": "Mbanga"
          },
          {
            "id": "CM005001007",
            "name": "Melong"
          },
          {
            "id": "CM005001008",
            "name": "Mombo"
          },
          {
            "id": "CM005001009",
            "name": "Njombe-Penja"
          },
          {
            "id": "CM005001010",
            "name": "Nkongsamba 1er"
          },
          {
            "id": "CM005001011",
            "name": "Nkongsamba 2e"
          },
          {
            "id": "CM005001012",
            "name": "Nkongsamba 3e"
          },
          {
            "id": "CM005001013",
            "name": "Nlonako"
          }
        ]
      },
      {
        "id": "CM005002",
        "name": "Nkam",
        "arrondissements": [
          {
            "id": "CM005002001",
            "name": "Nkondjock"
          },
          {
            "id": "CM005002002",
            "name": "Nord-Makombe"
          },
          {
            "id": "CM005002003",
            "name": "Yabassi"
          },
          {
            "id": "CM005002004",
            "name": "Yingui"
          }
        ]
      },
      {
        "id": "CM005003",
        "name": "Sanaga-Maritime",
        "arrondissements": [
          {
            "id": "CM005003001",
            "name": "Dibamba"
          },
          {
            "id": "CM005003002",
            "name": "Dizangue"
          },
          {
            "id": "CM005003003",
            "name": "Edea 1er"
          },
          {
            "id": "CM005003004",
            "name": "Edea 2e"
          },
          {
            "id": "CM005003005",
            "name": "Massock-Songloulou"
          },
          {
            "id": "CM005003006",
            "name": "Mouanko"
          },
          {
            "id": "CM005003007",
            "name": "Ndom"
          },
          {
            "id": "CM005003008",
            "name": "Ngambe"
          },
          {
            "id": "CM005003009",
            "name": "Ngwei"
          },
          {
            "id": "CM005003010",
            "name": "Nyanon"
          },
          {
            "id": "CM005003011",
            "name": "Pouma"
          }
        ]
      },
      {
        "id": "CM005004",
        "name": "Wouri",
        "arrondissements": [
          {
            "id": "CM005004001",
            "name": "Douala 1er"
          },
          {
            "id": "CM005004002",
            "name": "Douala 2e"
          },
          {
            "id": "CM005004003",
            "name": "Douala 3e"
          },
          {
            "id": "CM005004004",
            "name": "Douala 4e"
          },
          {
            "id": "CM005004005",
            "name": "Douala 5e"
          },
          {
            "id": "CM005004006",
            "name": "Douala 6e"
          }
        ]
      }
    ]
  },
  {
    "id": "CM006",
    "name": "Nord",
    "departments": [
      {
        "id": "CM006001",
        "name": "Bénoué",
        "arrondissements": [
          {
            "id": "CM006001001",
            "name": "Bascheo"
          },
          {
            "id": "CM006001002",
            "name": "Bibemi"
          },
          {
            "id": "CM006001003",
            "name": "Dembo"
          },
          {
            "id": "CM006001004",
            "name": "Demsa"
          },
          {
            "id": "CM006001005",
            "name": "Garoua 1er"
          },
          {
            "id": "CM006001006",
            "name": "Garoua 2e"
          },
          {
            "id": "CM006001007",
            "name": "Garoua 3e"
          },
          {
            "id": "CM006001008",
            "name": "Lagdo"
          },
          {
            "id": "CM006001009",
            "name": "Mayo-Hourna"
          },
          {
            "id": "CM006001010",
            "name": "Pitoa"
          },
          {
            "id": "CM006001011",
            "name": "Tcheboa"
          },
          {
            "id": "CM006001012",
            "name": "Touroua"
          }
        ]
      },
      {
        "id": "CM006002",
        "name": "Faro",
        "arrondissements": [
          {
            "id": "CM006002001",
            "name": "Beka"
          },
          {
            "id": "CM006002002",
            "name": "Poli"
          }
        ]
      },
      {
        "id": "CM006003",
        "name": "Mayo-Louti",
        "arrondissements": [
          {
            "id": "CM006003001",
            "name": "Figuil"
          },
          {
            "id": "CM006003002",
            "name": "Guider"
          },
          {
            "id": "CM006003003",
            "name": "Mayo-Oulo"
          }
        ]
      },
      {
        "id": "CM006004",
        "name": "Mayo-Rey",
        "arrondissements": [
          {
            "id": "CM006004001",
            "name": "Madingring"
          },
          {
            "id": "CM006004002",
            "name": "Rey-Bouba"
          },
          {
            "id": "CM006004003",
            "name": "Tchollire"
          },
          {
            "id": "CM006004004",
            "name": "Touboro"
          }
        ]
      }
    ]
  },
  {
    "id": "CM007",
    "name": "Nord-Ouest",
    "departments": [
      {
        "id": "CM007001",
        "name": "Boyo",
        "arrondissements": [
          {
            "id": "CM007001001",
            "name": "Belo"
          },
          {
            "id": "CM007001002",
            "name": "Bum"
          },
          {
            "id": "CM007001003",
            "name": "Fundong"
          },
          {
            "id": "CM007001004",
            "name": "Njinikom"
          }
        ]
      },
      {
        "id": "CM007002",
        "name": "Bui",
        "arrondissements": [
          {
            "id": "CM007002001",
            "name": "Jakiri"
          },
          {
            "id": "CM007002002",
            "name": "Kumbo"
          },
          {
            "id": "CM007002003",
            "name": "Mbven"
          },
          {
            "id": "CM007002004",
            "name": "Nkum"
          },
          {
            "id": "CM007002005",
            "name": "Noni"
          },
          {
            "id": "CM007002006",
            "name": "Oku"
          }
        ]
      },
      {
        "id": "CM007003",
        "name": "Donga-Mantung",
        "arrondissements": [
          {
            "id": "CM007003001",
            "name": "Ako"
          },
          {
            "id": "CM007003002",
            "name": "Misaje"
          },
          {
            "id": "CM007003003",
            "name": "Ndu"
          },
          {
            "id": "CM007003004",
            "name": "Nkambe"
          },
          {
            "id": "CM007003005",
            "name": "Nwa"
          }
        ]
      },
      {
        "id": "CM007004",
        "name": "Menchum",
        "arrondissements": [
          {
            "id": "CM007004001",
            "name": "Fungom"
          },
          {
            "id": "CM007004002",
            "name": "Furu-Awa"
          },
          {
            "id": "CM007004003",
            "name": "Menchum-Valley"
          },
          {
            "id": "CM007004004",
            "name": "Wum"
          }
        ]
      },
      {
        "id": "CM007005",
        "name": "Mezam",
        "arrondissements": [
          {
            "id": "CM007005001",
            "name": "Bafut"
          },
          {
            "id": "CM007005002",
            "name": "Bali"
          },
          {
            "id": "CM007005003",
            "name": "Bamenda 1st"
          },
          {
            "id": "CM007005004",
            "name": "Bamenda 2nd"
          },
          {
            "id": "CM007005005",
            "name": "Bamenda 3rd"
          },
          {
            "id": "CM007005006",
            "name": "Santa"
          },
          {
            "id": "CM007005007",
            "name": "Tubah"
          }
        ]
      },
      {
        "id": "CM007006",
        "name": "Momo",
        "arrondissements": [
          {
            "id": "CM007006001",
            "name": "Batibo"
          },
          {
            "id": "CM007006002",
            "name": "Mbengwi"
          },
          {
            "id": "CM007006003",
            "name": "Ngie"
          },
          {
            "id": "CM007006004",
            "name": "Njikwa"
          },
          {
            "id": "CM007006005",
            "name": "Widikum"
          }
        ]
      },
      {
        "id": "CM007007",
        "name": "Ngo-Ketunjia",
        "arrondissements": [
          {
            "id": "CM007007001",
            "name": "Babessi"
          },
          {
            "id": "CM007007002",
            "name": "Balikumbat"
          },
          {
            "id": "CM007007003",
            "name": "Ndop"
          }
        ]
      }
    ]
  },
  {
    "id": "CM009",
    "name": "Sud",
    "departments": [
      {
        "id": "CM009001",
        "name": "Dja-et-Lobo",
        "arrondissements": [
          {
            "id": "CM009001001",
            "name": "Bengbis"
          },
          {
            "id": "CM009001002",
            "name": "Djoum"
          },
          {
            "id": "CM009001003",
            "name": "Meyomessala"
          },
          {
            "id": "CM009001004",
            "name": "Meyomessi"
          },
          {
            "id": "CM009001005",
            "name": "Mintom"
          },
          {
            "id": "CM009001006",
            "name": "Oveng"
          },
          {
            "id": "CM009001007",
            "name": "Sangmelima"
          },
          {
            "id": "CM009001008",
            "name": "Zoetele"
          }
        ]
      },
      {
        "id": "CM009002",
        "name": "Mvila",
        "arrondissements": [
          {
            "id": "CM009002001",
            "name": "Biwong-Bane"
          },
          {
            "id": "CM009002002",
            "name": "Biwong-Bulu"
          },
          {
            "id": "CM009002003",
            "name": "Ebolowa 1er"
          },
          {
            "id": "CM009002004",
            "name": "Ebolowa 2e"
          },
          {
            "id": "CM009002005",
            "name": "Efoulan"
          },
          {
            "id": "CM009002006",
            "name": "Mengong"
          },
          {
            "id": "CM009002007",
            "name": "Mvangane"
          },
          {
            "id": "CM009002008",
            "name": "Ngoulemakong"
          }
        ]
      },
      {
        "id": "CM009003",
        "name": "Océan",
        "arrondissements": [
          {
            "id": "CM009003001",
            "name": "Akom 2"
          },
          {
            "id": "CM009003002",
            "name": "Bipindi"
          },
          {
            "id": "CM009003003",
            "name": "Campo"
          },
          {
            "id": "CM009003004",
            "name": "Kribi 1er"
          },
          {
            "id": "CM009003005",
            "name": "Kribi 2e"
          },
          {
            "id": "CM009003006",
            "name": "Lokoundje"
          },
          {
            "id": "CM009003007",
            "name": "Lolodorf"
          },
          {
            "id": "CM009003008",
            "name": "Mvengue"
          },
          {
            "id": "CM009003009",
            "name": "Niete"
          }
        ]
      },
      {
        "id": "CM009004",
        "name": "Vallée-du-Ntem",
        "arrondissements": [
          {
            "id": "CM009004001",
            "name": "Ambam"
          },
          {
            "id": "CM009004002",
            "name": "Kye-Ossi"
          },
          {
            "id": "CM009004003",
            "name": "Maan"
          },
          {
            "id": "CM009004004",
            "name": "Olamze"
          }
        ]
      }
    ]
  },
  {
    "id": "CM010",
    "name": "Sud-Ouest",
    "departments": [
      {
        "id": "CM010001",
        "name": "Fako",
        "arrondissements": [
          {
            "id": "CM010001001",
            "name": "Buea"
          },
          {
            "id": "CM010001002",
            "name": "Limbe 1st"
          },
          {
            "id": "CM010001003",
            "name": "Limbe 2nd"
          },
          {
            "id": "CM010001004",
            "name": "Limbe 3rd"
          },
          {
            "id": "CM010001005",
            "name": "Muyuka"
          },
          {
            "id": "CM010001006",
            "name": "Tiko"
          },
          {
            "id": "CM010001007",
            "name": "West-Coast"
          }
        ]
      },
      {
        "id": "CM010002",
        "name": "Kupe-Manenguba",
        "arrondissements": [
          {
            "id": "CM010002001",
            "name": "Bangem"
          },
          {
            "id": "CM010002002",
            "name": "Nguti"
          },
          {
            "id": "CM010002003",
            "name": "Tombel"
          }
        ]
      },
      {
        "id": "CM010003",
        "name": "Lebialem",
        "arrondissements": [
          {
            "id": "CM010003001",
            "name": "Alou"
          },
          {
            "id": "CM010003002",
            "name": "Fontem"
          },
          {
            "id": "CM010003003",
            "name": "Wabane"
          }
        ]
      },
      {
        "id": "CM010004",
        "name": "Manyu",
        "arrondissements": [
          {
            "id": "CM010004001",
            "name": "Akwaya"
          },
          {
            "id": "CM010004002",
            "name": "Eyumodjock"
          },
          {
            "id": "CM010004003",
            "name": "Mamfe"
          },
          {
            "id": "CM010004004",
            "name": "Upper Bayang"
          }
        ]
      },
      {
        "id": "CM010005",
        "name": "Meme",
        "arrondissements": [
          {
            "id": "CM010005001",
            "name": "Konye"
          },
          {
            "id": "CM010005002",
            "name": "Kumba 1st"
          },
          {
            "id": "CM010005003",
            "name": "Kumba 2nd"
          },
          {
            "id": "CM010005004",
            "name": "Kumba 3rd"
          },
          {
            "id": "CM010005005",
            "name": "Mbonge"
          }
        ]
      },
      {
        "id": "CM010006",
        "name": "Ndian",
        "arrondissements": [
          {
            "id": "CM010006001",
            "name": "Bamusso"
          },
          {
            "id": "CM010006002",
            "name": "Dikome Balue"
          },
          {
            "id": "CM010006003",
            "name": "Ekondo Titi"
          },
          {
            "id": "CM010006004",
            "name": "Idabato"
          },
          {
            "id": "CM010006005",
            "name": "Isangele"
          },
          {
            "id": "CM010006006",
            "name": "Kombo Abedimo"
          },
          {
            "id": "CM010006007",
            "name": "Kombo Itindi"
          },
          {
            "id": "CM010006008",
            "name": "Mundemba"
          },
          {
            "id": "CM010006009",
            "name": "Toko"
          }
        ]
      }
    ]
  },
  {
    "id": "CM008",
    "name": "Ouest",
    "departments": [
      {
        "id": "CM008001",
        "name": "Bamboutos",
        "arrondissements": [
          {
            "id": "CM008001001",
            "name": "Babadjou"
          },
          {
            "id": "CM008001002",
            "name": "Batcham"
          },
          {
            "id": "CM008001003",
            "name": "Galim"
          },
          {
            "id": "CM008001004",
            "name": "Mbouda"
          }
        ]
      },
      {
        "id": "CM008002",
        "name": "Haut-Nkam",
        "arrondissements": [
          {
            "id": "CM008002001",
            "name": "Bafang"
          },
          {
            "id": "CM008002002",
            "name": "Bakou"
          },
          {
            "id": "CM008002003",
            "name": "Bana"
          },
          {
            "id": "CM008002004",
            "name": "Bandja"
          },
          {
            "id": "CM008002005",
            "name": "Banka"
          },
          {
            "id": "CM008002006",
            "name": "Banwa"
          },
          {
            "id": "CM008002007",
            "name": "Kekem"
          }
        ]
      },
      {
        "id": "CM008003",
        "name": "Hauts-Plateaux",
        "arrondissements": [
          {
            "id": "CM008003001",
            "name": "Baham"
          },
          {
            "id": "CM008003002",
            "name": "Bamendjou"
          },
          {
            "id": "CM008003003",
            "name": "Bangou"
          },
          {
            "id": "CM008003004",
            "name": "Batie"
          }
        ]
      },
      {
        "id": "CM008004",
        "name": "Koung-Khi",
        "arrondissements": [
          {
            "id": "CM008004001",
            "name": "Bayangam"
          },
          {
            "id": "CM008004002",
            "name": "Djebem"
          },
          {
            "id": "CM008004003",
            "name": "Poumougne"
          }
        ]
      },
      {
        "id": "CM008005",
        "name": "Menoua",
        "arrondissements": [
          {
            "id": "CM008005001",
            "name": "Dschang"
          },
          {
            "id": "CM008005002",
            "name": "Fokoue"
          },
          {
            "id": "CM008005003",
            "name": "Fongo-Tongo"
          },
          {
            "id": "CM008005004",
            "name": "Nkong-Ni"
          },
          {
            "id": "CM008005005",
            "name": "Penka-Michel"
          },
          {
            "id": "CM008005006",
            "name": "Santchou"
          }
        ]
      },
      {
        "id": "CM008006",
        "name": "Mifi",
        "arrondissements": [
          {
            "id": "CM008006001",
            "name": "Bafoussam 1er"
          },
          {
            "id": "CM008006002",
            "name": "Bafoussam 2e"
          },
          {
            "id": "CM008006003",
            "name": "Bafoussam 3e"
          }
        ]
      },
      {
        "id": "CM008007",
        "name": "Ndé",
        "arrondissements": [
          {
            "id": "CM008007001",
            "name": "Bangangte"
          },
          {
            "id": "CM008007002",
            "name": "Bassamba"
          },
          {
            "id": "CM008007003",
            "name": "Bazou"
          },
          {
            "id": "CM008007004",
            "name": "Tonga"
          }
        ]
      },
      {
        "id": "CM008008",
        "name": "Noun",
        "arrondissements": [
          {
            "id": "CM008008001",
            "name": "Bangourain"
          },
          {
            "id": "CM008008002",
            "name": "Foumban"
          },
          {
            "id": "CM008008003",
            "name": "Foumbot"
          },
          {
            "id": "CM008008004",
            "name": "Kouoptamo"
          },
          {
            "id": "CM008008005",
            "name": "Koutaba"
          },
          {
            "id": "CM008008006",
            "name": "Magba"
          },
          {
            "id": "CM008008007",
            "name": "Malantouen"
          },
          {
            "id": "CM008008008",
            "name": "Massangam"
          },
          {
            "id": "CM008008009",
            "name": "Njimom"
          }
        ]
      }
    ]
  }
];

export const CAMEROON_REGIONS = CAMEROON_ADMINISTRATIVE_HIERARCHY;
