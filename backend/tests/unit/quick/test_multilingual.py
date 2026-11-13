"""S1 in many languages: native-script (and romanized) requests -> the same form fields, by rules only."""

from pathlib import Path

import pytest

from app.catalog.loader import load_catalog
from app.quick.multilingual import SUPPORTED_LANGUAGES, detect_language, parse_multilingual

DATA = Path(__file__).resolve().parents[4] / "data"

MENON = {"origin": "BLR", "country": "Japan", "start_date": "2027-04-10", "nights": 6, "adults": 2,
         "children_ages": [6], "budget": 350000}

# One natural sentence per language: from Bengaluru to Japan on 10 April, 6 nights, 2 adults and a
# 6-year-old child, budget 3.5 lakh.
SENTENCES = {
    "en": "2 adults and a 6 year old child from Bengaluru to Japan on 10 April for 6 nights, budget 3.5 lakh",
    "hi": "मुझे 10 अप्रैल को बेंगलुरु से जापान जाना है, 6 रातों के लिए, 2 वयस्क और 6 साल का एक बच्चा, बजट 3.5 लाख रुपये",
    "mr": "मला १० एप्रिलला बेंगळुरूहून जपानला जायचे आहे, ६ रात्रींसाठी, २ प्रौढ आणि ६ वर्षांचे एक मूल, बजेट ३.५ लाख रुपये",
    "bn": "আমি ১০ এপ্রিল বেঙ্গালুরু থেকে জাপান যেতে চাই, ৬ রাতের জন্য, ২ জন প্রাপ্তবয়স্ক এবং ৬ বছরের একটি শিশু, বাজেট ৩.৫ লাখ টাকা",
    "te": "నాకు ఏప్రిల్ 10న బెంగళూరు నుండి జపాన్ వెళ్లాలి, 6 రాత్రులు, 2 పెద్దలు మరియు 6 సంవత్సరాల ఒక పిల్లవాడు, బడ్జెట్ 3.5 లక్షలు",
    "ta": "நான் ஏப்ரல் 10 அன்று பெங்களூருவிலிருந்து ஜப்பானுக்கு செல்ல விரும்புகிறேன், 6 இரவுகள், 2 பெரியவர்கள் மற்றும் 6 வயது குழந்தை ஒன்று, பட்ஜெட் 3.5 லட்சம்",
    "gu": "મારે 10 એપ્રિલે બેંગલુરુથી જાપાન જવું છે, 6 રાત માટે, 2 પુખ્ત અને 6 વર્ષનું એક બાળક, બજેટ 3.5 લાખ રૂપિયા",
    "kn": "ನಾನು ಏಪ್ರಿಲ್ 10 ರಂದು ಬೆಂಗಳೂರಿನಿಂದ ಜಪಾನಿಗೆ ಹೋಗಲು ಬಯಸುತ್ತೇನೆ, 6 ರಾತ್ರಿಗಳು, 2 ವಯಸ್ಕರು ಮತ್ತು 6 ವರ್ಷದ ಒಂದು ಮಗು, ಬಜೆಟ್ 3.5 ಲಕ್ಷ",
    "ml": "എനിക്ക് ഏപ്രിൽ 10-ന് ബെംഗളൂരുവിൽ നിന്ന് ജപ്പാനിലേക്ക് പോകണം, 6 രാത്രി, 2 മുതിർന്നവർ, 6 വയസ്സുള്ള ഒരു കുട്ടി, ബജറ്റ് 3.5 ലക്ഷം",
    "or": "ମୁଁ 10 ଏପ୍ରିଲରେ ବେଙ୍ଗାଲୁରୁରୁ ଜାପାନ ଯିବାକୁ ଚାହୁଁଛି, 6 ରାତି, 2 ବୟସ୍କ ଏବଂ 6 ବର୍ଷର ଗୋଟିଏ ପିଲା, ବଜେଟ 3.5 ଲକ୍ଷ",
    "pa": "ਮੈਂ 10 ਅਪ੍ਰੈਲ ਨੂੰ ਬੰਗਲੌਰ ਤੋਂ ਜਪਾਨ ਜਾਣਾ ਚਾਹੁੰਦਾ ਹਾਂ, 6 ਰਾਤਾਂ ਲਈ, 2 ਬਾਲਗ ਅਤੇ 6 ਸਾਲ ਦਾ ਇੱਕ ਬੱਚਾ, ਬਜਟ 3.5 ਲੱਖ",
    "as": "মই ১০ এপ্ৰিলত বেংগালুৰুৰ পৰা জাপানলৈ যাব বিচাৰো, ৬ ৰাতিৰ বাবে, ২ জন প্ৰাপ্তবয়স্ক আৰু ৬ বছৰীয়া এটা শিশু, বাজেট ৩.৫ লাখ টকা",
    "ur": "میں 10 اپریل کو بنگلورو سے جاپان جانا چاہتا ہوں، 6 راتوں کے لیے، 2 بالغ اور 6 سال کا ایک بچہ، بجٹ 3.5 لاکھ روپے",
}


@pytest.fixture(scope="module")
def catalog():
    return load_catalog(DATA)


@pytest.mark.parametrize("lang", sorted(SENTENCES))
def test_each_language_fills_the_same_form(catalog, lang):
    result = parse_multilingual(SENTENCES[lang], catalog)
    assert result["fields"] == MENON, result
    assert result["missing"] == []
    assert result["language"] == lang
    assert result["supported"] is True


@pytest.mark.parametrize("lang", sorted(SENTENCES))
def test_language_is_detected(lang):
    assert detect_language(SENTENCES[lang])["language"] == lang


def test_at_least_ten_indian_languages():
    indian = [code for code in SUPPORTED_LANGUAGES if code != "en"]
    assert len(indian) >= 10
    assert set(SENTENCES) - {"en"} <= set(indian)


def test_devanagari_digits_and_spoken_halves(catalog):
    r = parse_multilingual("मुझे दिल्ली से दुबई जाना है, ५ अप्रैल से ५ रातें, दो वयस्क, बजट साढ़े तीन लाख", catalog)
    assert r["fields"] == {"origin": "DEL", "country": "United Arab Emirates", "start_date": "2027-04-05",
                           "nights": 5, "adults": 2, "children_ages": [], "budget": 350000}


def test_spoken_number_words_in_hindi(catalog):
    r = parse_multilingual("चेन्नई से टोक्यो, छह रातें, दो वयस्क, 14 अप्रैल, बजट चार लाख", catalog)
    assert r["fields"]["origin"] == "MAA"
    assert r["fields"]["country"] == "Japan"
    assert r["fields"]["nights"] == 6
    assert r["fields"]["adults"] == 2
    assert r["fields"]["budget"] == 400000


def test_origin_is_the_city_before_the_from_word(catalog):
    r = parse_multilingual("मुंबई से दिल्ली", catalog)
    assert r["fields"]["origin"] == "BOM"


def test_romanized_hindi(catalog):
    text = "mujhe Bengaluru se Japan jaana hai, 10 April ko, 6 raat ke liye, 2 vayask aur 6 saal ka ek bachcha, budget 3.5 lakh"
    r = parse_multilingual(text, catalog)
    assert r["fields"] == MENON
    assert r["language"] == "hi"
    assert r["script"] == "latin"


def test_plain_english_is_not_mistaken_for_romanized_hindi():
    assert detect_language("Two adults from Delhi to Dubai for five nights from 4 April under 2 lakh")["language"] == "en"


def test_english_still_works_and_reports_english(catalog):
    r = parse_multilingual("Family of 3 from Bengaluru to Japan on 10 April 2027 for 6 nights, 2 adults and 1 child aged 6, budget 3,50,000", catalog)
    assert r["fields"] == MENON
    assert r["language"] == "en"


def test_missing_fields_are_still_reported(catalog):
    r = parse_multilingual("मुझे जापान जाना है", catalog)
    assert r["fields"] == {"country": "Japan"}
    assert "budget" in r["missing"]
    assert r["language"] == "hi"


def test_unsupported_script_is_reported_not_guessed(catalog):
    r = parse_multilingual("東京へ行きたいです", catalog)
    assert r["fields"] == {}
    assert r["supported"] is False


def test_date_word_is_not_read_as_days(catalog):
    r = parse_multilingual("दिनांक 10 अप्रैल को दिल्ली से दुबई, 5 रातें, 2 वयस्क, बजट 2 लाख", catalog)
    assert r["fields"]["nights"] == 5


def test_empty_text(catalog):
    r = parse_multilingual("", catalog)
    assert r["fields"] == {} and r["language"] == "en"


@pytest.mark.parametrize(("text", "ages"), [
    ("दिल्ली से दुबई, 5 अप्रैल, 5 रातें, 2 वयस्क और 2 बच्चे 4 और 9 साल के, बजट 2 लाख", [4, 9]),
    ("டெல்லியிலிருந்து துபாய், ஏப்ரல் 5, 5 இரவுகள், 2 பெரியவர்கள், 2 குழந்தைகள் 4 மற்றும் 9 வயது, பட்ஜெட் 2 லட்சம்", [4, 9]),
    ("دہلی سے دبئی، 5 اپریل، 5 راتیں، 2 بالغ اور 3 بچے 2، 7 اور 11 سال کے، بجٹ 2 لاکھ", [2, 7, 11]),
])
def test_several_children_ages_in_one_phrase(catalog, text, ages):
    assert parse_multilingual(text, catalog)["fields"]["children_ages"] == ages


def test_a_lone_number_before_the_age_is_not_swallowed_into_the_ages(catalog):
    r = parse_multilingual("दिल्ली से दुबई, 5 अप्रैल, 5 रातें, 2 वयस्क, 6 साल का एक बच्चा, बजट 2 लाख", catalog)
    assert r["fields"]["adults"] == 2 and r["fields"]["children_ages"] == [6]
