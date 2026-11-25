import importlib.util,math,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('evaluate',Path(__file__).parents[1]/'analysis/evaluate.py');e=importlib.util.module_from_spec(spec);spec.loader.exec_module(e)
class StatisticsTest(unittest.TestCase):
 def test_known_t_quantile(self):self.assertAlmostEqual(e.cdf(2.306004135,8),.975,places=7)
 def test_paired_mean_and_interval(self):
  r=e.paired([(1,2),(2,4),(3,6)]);self.assertEqual(r['difference'],2);self.assertAlmostEqual(r['ci95'][1]-2,4.30265273/math.sqrt(3),places=6)
 def test_missing_scores(self):self.assertIsNone(e.sus([3]*9));self.assertIsNone(e.number(''))
 def test_sus(self):self.assertEqual(e.sus([5,1]*5),100)
if __name__=='__main__':unittest.main()
